Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  
  const user1Email = Deno.env.get('USER_1_EMAIL') ?? '';
  const user2Email = Deno.env.get('USER_2_EMAIL') ?? '';
  const AUTHORIZED_USERS = [user1Email, user2Email];
  
  const MEDIA_BUCKET = 'make-13a04c32-media';
  
  // Helper to create Supabase client
  const createSupabaseClient = (isService = false) => {
    const key = isService ? supabaseServiceKey : supabaseAnonKey;
    return { url: supabaseUrl, key };
  };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // Simple KV store helpers (inline SQL)
  const kv = {
    set: async (key: string, value: any) => {
      const response = await fetch(`${supabaseUrl}/rest/v1/kv_store_13a04c32`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ key, value }),
      });
      return response.ok;
    },
    get: async (key: string) => {
      const response = await fetch(`${supabaseUrl}/rest/v1/kv_store_13a04c32?key=eq.${encodeURIComponent(key)}&select=value`, {
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
      });
      const data = await response.json();
      return data[0]?.value;
    },
    del: async (key: string) => {
      await fetch(`${supabaseUrl}/rest/v1/kv_store_13a04c32?key=eq.${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
      });
    },
    getByPrefix: async (prefix: string) => {
      const response = await fetch(`${supabaseUrl}/rest/v1/kv_store_13a04c32?key=like.${encodeURIComponent(prefix + '%')}&select=value`, {
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
      });
      const data = await response.json();
      return data.map((d: any) => d.value);
    },
  };

  const url = new URL(req.url);
  let path = url.pathname;
  
  // Always respond to root for testing - remove any function prefix
  const functionMatch = path.match(/^\/functions\/v1\/[^/]+(.*)$/);
  if (functionMatch) {
    path = functionMatch[1] || '/';
  }
  
  const method = req.method;

  // Health check - ruta raíz
  if (path === '/' || path === '') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  if (path === '/health') {
    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // Helper to get user from token
  const getUser = async (authHeader: string | null) => {
    if (!authHeader) return null;
    const token = authHeader.replace('Bearer ', '');
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${token}`,
      },
    });
    return response.ok ? await response.json() : null;
  };

  const authHeader = req.headers.get('Authorization');
  const user = await getUser(authHeader);
  
  const isAuthorized = user && AUTHORIZED_USERS.includes(user.email ?? '');

  // Auth routes
  if (path === '/auth/signin' && method === 'POST') {
    const { email, password } = await req.json();
    if (!AUTHORIZED_USERS.includes(email)) {
      return new Response(JSON.stringify({ error: 'Unauthorized email' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (!response.ok) {
      return new Response(JSON.stringify({ error: data.error_description || 'Invalid credentials' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ access_token: data.access_token, user: data.user }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (path === '/auth/session' && method === 'GET') {
    if (!authHeader) {
      return new Response(JSON.stringify({ session: null }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized user' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ user }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Protected routes - require auth
  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get albums
  if (path === '/albums' && method === 'GET') {
    const albums = await kv.getByPrefix('album:');
    const filtered = albums.filter((a: any) => !a.deleted).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return new Response(JSON.stringify({ albums: filtered }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create album
  if (path === '/albums' && method === 'POST') {
    const { name, description, coverUrl } = await req.json();
    const albumId = crypto.randomUUID();
    const album = {
      id: albumId,
      name,
      description: description || '',
      coverUrl: coverUrl || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: user.id,
      deleted: false,
    };
    await kv.set(`album:${albumId}`, album);
    return new Response(JSON.stringify({ album }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update album
  if (path.startsWith('/albums/') && path.endsWith('/') === false && method === 'PUT') {
    const albumId = path.split('/')[2];
    const updates = await req.json();
    const existingAlbum = await kv.get(`album:${albumId}`);
    if (!existingAlbum) {
      return new Response(JSON.stringify({ error: 'Album not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    const updatedAlbum = { ...existingAlbum, ...updates, updatedAt: new Date().toISOString() };
    await kv.set(`album:${albumId}`, updatedAlbum);
    return new Response(JSON.stringify({ album: updatedAlbum }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete album
  if (path.startsWith('/albums/') && path.endsWith('/') === false && method === 'DELETE') {
    const albumId = path.split('/')[2];
    const album = await kv.get(`album:${albumId}`);
    if (!album) {
      return new Response(JSON.stringify({ error: 'Album not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    const deletedAlbum = { ...album, deleted: true, deletedAt: new Date().toISOString(), deletedBy: user.id };
    await kv.set(`album:${albumId}`, deletedAlbum);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get media for album
  if (path.match(/^\/albums\/[^/]+\/media$/) && method === 'GET') {
    const albumId = path.split('/')[2];
    const allMedia = await kv.getByPrefix(`media:${albumId}:`);
    const filteredMedia = allMedia.filter((m: any) => !m.deleted).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    // Generate signed URLs
    const mediaWithUrls = await Promise.all(filteredMedia.map(async (media: any) => {
      const signedUrlResponse = await fetch(`${supabaseUrl}/storage/v1/object/sign/${MEDIA_BUCKET}/${media.path}`, {
        method: 'POST',
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 3600 }),
      });
      const signedData = await signedUrlResponse.json();
      const fullUrl = signedData.signedURL ? `${supabaseUrl}/storage/v1${signedData.signedURL}` : '';
      return { ...media, url: fullUrl };
    }));
    
    return new Response(JSON.stringify({ media: mediaWithUrls }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Upload media
  if (path.match(/^\/albums\/[^/]+\/media$/) && method === 'POST') {
    const albumId = path.split('/')[2];
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const mediaId = crypto.randomUUID();
    const fileExt = file.name.split('.').pop();
    const filePath = `${albumId}/${mediaId}.${fileExt}`;
    
    // Upload to storage
    const uploadResponse = await fetch(`${supabaseUrl}/storage/v1/object/${MEDIA_BUCKET}/${filePath}`, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': file.type,
      },
      body: await file.arrayBuffer(),
    });
    
    if (!uploadResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to upload file' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Save metadata
    const media = {
      id: mediaId,
      albumId,
      path: filePath,
      name: file.name,
      type: file.type,
      size: file.size,
      createdAt: new Date().toISOString(),
      createdBy: user.id,
      deleted: false,
    };
    await kv.set(`media:${albumId}:${mediaId}`, media);
    
    // Generate signed URL
    const signedUrlResponse = await fetch(`${supabaseUrl}/storage/v1/object/sign/${MEDIA_BUCKET}/${filePath}`, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    const signedData = await signedUrlResponse.json();
    const fullUrl = signedData.signedURL ? `${supabaseUrl}/storage/v1${signedData.signedURL}` : '';
    
    return new Response(JSON.stringify({ media: { ...media, url: fullUrl } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete media
  if (path.match(/^\/media\/[^/]+\/[^/]+$/) && method === 'DELETE') {
    const parts = path.split('/');
    const albumId = parts[2];
    const mediaId = parts[3];
    const media = await kv.get(`media:${albumId}:${mediaId}`);
    
    if (!media) {
      return new Response(JSON.stringify({ error: 'Media not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const deletedMedia = { ...media, deleted: true, deletedAt: new Date().toISOString(), deletedBy: user.id };
    await kv.set(`media:${albumId}:${mediaId}`, deletedMedia);
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get trash
  if (path === '/trash' && method === 'GET') {
    const allAlbums = await kv.getByPrefix('album:');
    const allMedia = await kv.getByPrefix('media:');
    const deletedAlbums = allAlbums.filter((a: any) => a.deleted);
    const deletedMedia = allMedia.filter((m: any) => m.deleted);
    
    const mediaWithUrls = await Promise.all(deletedMedia.map(async (media: any) => {
      const signedUrlResponse = await fetch(`${supabaseUrl}/storage/v1/object/sign/${MEDIA_BUCKET}/${media.path}`, {
        method: 'POST',
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 3600 }),
      });
      const signedData = await signedUrlResponse.json();
      const fullUrl = signedData.signedURL ? `${supabaseUrl}/storage/v1${signedData.signedURL}` : '';
      return { ...media, url: fullUrl };
    }));
    
    return new Response(JSON.stringify({ albums: deletedAlbums, media: mediaWithUrls }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Restore item
  if (path === '/trash/restore' && method === 'POST') {
    const { type, id, albumId } = await req.json();
    
    if (type === 'album') {
      const album = await kv.get(`album:${id}`);
      if (album) await kv.set(`album:${id}`, { ...album, deleted: false });
    } else if (type === 'media' && albumId) {
      const media = await kv.get(`media:${albumId}:${id}`);
      if (media) await kv.set(`media:${albumId}:${id}`, { ...media, deleted: false });
    }
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Restore all
  if (path === '/trash/restore-all' && method === 'POST') {
    const allAlbums = await kv.getByPrefix('album:');
    const allMedia = await kv.getByPrefix('media:');
    const deletedAlbums = allAlbums.filter((a: any) => a.deleted);
    const deletedMedia = allMedia.filter((m: any) => m.deleted);
    
    for (const album of deletedAlbums) {
      await kv.set(`album:${album.id}`, { ...album, deleted: false });
    }
    for (const media of deletedMedia) {
      await kv.set(`media:${media.albumId}:${media.id}`, { ...media, deleted: false });
    }
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete permanently
  if (path.startsWith('/trash/') && method === 'DELETE') {
    const parts = path.split('/');
    const type = parts[2];
    const id = parts[3];
    const albumId = url.searchParams.get('albumId');
    
    if (type === 'album') {
      const album = await kv.get(`album:${id}`);
      if (album) {
        const allMedia = await kv.getByPrefix(`media:${id}:`);
        for (const media of allMedia) {
          await fetch(`${supabaseUrl}/storage/v1/object/${MEDIA_BUCKET}/${media.path}`, {
            method: 'DELETE',
            headers: {
              'apikey': supabaseServiceKey,
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
          });
          await kv.del(`media:${id}:${media.id}`);
        }
        await kv.del(`album:${id}`);
      }
    } else if (type === 'media' && albumId) {
      const media = await kv.get(`media:${albumId}:${id}`);
      if (media) {
        await fetch(`${supabaseUrl}/storage/v1/object/${MEDIA_BUCKET}/${media.path}`, {
          method: 'DELETE',
          headers: {
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
        });
        await kv.del(`media:${albumId}:${id}`);
      }
    }
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Empty trash
  if (path === '/trash' && method === 'DELETE') {
    const allAlbums = await kv.getByPrefix('album:');
    const allMedia = await kv.getByPrefix('media:');
    const deletedAlbums = allAlbums.filter((a: any) => a.deleted);
    const deletedMedia = allMedia.filter((m: any) => m.deleted);
    
    for (const album of deletedAlbums) {
      await kv.del(`album:${album.id}`);
    }
    for (const media of deletedMedia) {
      await fetch(`${supabaseUrl}/storage/v1/object/${MEDIA_BUCKET}/${media.path}`, {
        method: 'DELETE',
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
      });
      await kv.del(`media:${media.albumId}:${media.id}`);
    }
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 404 for unmatched routes
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404, headers: { 'Content-Type': 'application/json' },
  });
});
