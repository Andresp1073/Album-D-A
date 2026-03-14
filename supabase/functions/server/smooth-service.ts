Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const user1Email = Deno.env.get('USER_1_EMAIL') ?? '';
  const user2Email = Deno.env.get('USER_2_EMAIL') ?? '';
  const AUTHORIZED_USERS = [user1Email, user2Email];
  const MEDIA_BUCKET = 'make-13a04c32-media';

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

  const getPath = (reqUrl: string) => {
    const url = new URL(reqUrl);
    // Match either function name: /functions/v1/function-name/path
    const match = url.pathname.match(/^\/functions\/v1\/[^/]+(\/.*)$/);
    return match ? (match[1] || '/') : url.pathname;
  };

  const path = getPath(req.url);
  const method = req.method;
  const authHeader = req.headers.get('Authorization');

  // KV store helpers
  const kv = {
    set: async (key: string, value: any) => {
      await fetch(`${supabaseUrl}/rest/v1/kv_store_13a04c32`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': supabaseServiceKey, 'Authorization': `Bearer ${supabaseServiceKey}`, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ key, value }),
      });
    },
    get: async (key: string) => {
      const res = await fetch(`${supabaseUrl}/rest/v1/kv_store_13a04c32?key=eq.${encodeURIComponent(key)}&select=value`, { headers: { 'apikey': supabaseServiceKey, 'Authorization': `Bearer ${supabaseServiceKey}` } });
      const data = await res.json();
      return data[0]?.value;
    },
    del: async (key: string) => {
      await fetch(`${supabaseUrl}/rest/v1/kv_store_13a04c32?key=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: { 'apikey': supabaseServiceKey, 'Authorization': `Bearer ${supabaseServiceKey}` } });
    },
    getByPrefix: async (prefix: string) => {
      const res = await fetch(`${supabaseUrl}/rest/v1/kv_store_13a04c32?key=like.${encodeURIComponent(prefix + '%')}&select=value`, { headers: { 'apikey': supabaseServiceKey, 'Authorization': `Bearer ${supabaseServiceKey}` } });
      const data = await res.json();
      return data.map((d: any) => d.value);
    },
  };

  const jsonResponse = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

  const getUser = async () => {
    if (!authHeader) return null;
    const token = authHeader.replace('Bearer ', '');
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { 'apikey': supabaseAnonKey, 'Authorization': `Bearer ${token}` } });
    return res.ok ? await res.json() : null;
  };

  const user = await getUser();
  const isAuthorized = user && AUTHORIZED_USERS.includes(user.email ?? '');

  // Root and health (public)
  if (path === '/' || path === '') return jsonResponse({ ok: true });
  if (path === '/health') return jsonResponse({ status: 'ok' });

  // Auth routes
  if (path === '/auth/signin' && method === 'POST') {
    const { email, password } = await req.json();
    if (!AUTHORIZED_USERS.includes(email)) return jsonResponse({ error: 'Unauthorized email' }, 403);
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': supabaseAnonKey }, body: JSON.stringify({ email, password }) });
    const data = await res.json();
    if (!res.ok) return jsonResponse({ error: data.error_description || 'Invalid credentials' }, 400);
    return jsonResponse({ access_token: data.access_token, user: data.user });
  }

  if (path === '/auth/session' && method === 'GET') {
    if (!authHeader) return jsonResponse({ session: null }, 401);
    if (!isAuthorized) return jsonResponse({ error: 'Unauthorized user' }, 403);
    return jsonResponse({ user });
  }

  // Protected routes
  if (!isAuthorized) return jsonResponse({ error: 'Unauthorized' }, 401);

  // Albums
  if (path === '/albums' && method === 'GET') {
    const albums = await kv.getByPrefix('album:');
    const filtered = albums.filter((a: any) => !a.deleted).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return jsonResponse({ albums: filtered });
  }

  if (path === '/albums' && method === 'POST') {
    const { name, description, coverUrl } = await req.json();
    const albumId = crypto.randomUUID();
    const album = { id: albumId, name, description: description || '', coverUrl: coverUrl || null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: user.id, deleted: false };
    await kv.set(`album:${albumId}`, album);
    return jsonResponse({ album });
  }

  if (path.startsWith('/albums/') && path.split('/').length === 3) {
    const albumId = path.split('/')[2];
    
    if (method === 'PUT') {
      const updates = await req.json();
      const existingAlbum = await kv.get(`album:${albumId}`);
      if (!existingAlbum) return jsonResponse({ error: 'Album not found' }, 404);
      const updatedAlbum = { ...existingAlbum, ...updates, updatedAt: new Date().toISOString() };
      await kv.set(`album:${albumId}`, updatedAlbum);
      return jsonResponse({ album: updatedAlbum });
    }
    
    if (method === 'DELETE') {
      const album = await kv.get(`album:${albumId}`);
      if (!album) return jsonResponse({ error: 'Album not found' }, 404);
      const deletedAlbum = { ...album, deleted: true, deletedAt: new Date().toISOString(), deletedBy: user.id };
      await kv.set(`album:${albumId}`, deletedAlbum);
      return jsonResponse({ success: true });
    }
  }

  // Media
  const mediaMatch = path.match(/^\/albums\/([^/]+)\/media$/);
  if (mediaMatch && method === 'GET') {
    const albumId = mediaMatch[1];
    const allMedia = await kv.getByPrefix(`media:${albumId}:`);
    const filteredMedia = allMedia.filter((m: any) => !m.deleted).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const mediaWithUrls = await Promise.all(filteredMedia.map(async (media: any) => {
      const res = await fetch(`${supabaseUrl}/storage/v1/object/sign/${MEDIA_BUCKET}/${media.path}`, { method: 'POST', headers: { 'apikey': supabaseServiceKey, 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
      const signedData = await res.json();
      return { ...media, url: signedData.signedURL ? `${supabaseUrl}/storage/v1${signedData.signedURL}` : '' };
    }));
    return jsonResponse({ media: mediaWithUrls });
  }

  if (mediaMatch && method === 'POST') {
    const albumId = mediaMatch[1];
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return jsonResponse({ error: 'No file provided' }, 400);
    const mediaId = crypto.randomUUID();
    const fileExt = file.name.split('.').pop();
    const filePath = `${albumId}/${mediaId}.${fileExt}`;
    const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/${MEDIA_BUCKET}/${filePath}`, { method: 'POST', headers: { 'apikey': supabaseServiceKey, 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': file.type }, body: await file.arrayBuffer() });
    if (!uploadRes.ok) return jsonResponse({ error: 'Failed to upload file' }, 500);
    const media = { id: mediaId, albumId, path: filePath, name: file.name, type: file.type, size: file.size, createdAt: new Date().toISOString(), createdBy: user.id, deleted: false };
    await kv.set(`media:${albumId}:${mediaId}`, media);
    const signedRes = await fetch(`${supabaseUrl}/storage/v1/object/sign/${MEDIA_BUCKET}/${filePath}`, { method: 'POST', headers: { 'apikey': supabaseServiceKey, 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
    const signedData = await signedRes.json();
    return jsonResponse({ media: { ...media, url: signedData.signedURL ? `${supabaseUrl}/storage/v1${signedData.signedURL}` : '' } });
  }

  // Delete media
  const deleteMediaMatch = path.match(/^\/media\/([^/]+)\/([^/]+)$/);
  if (deleteMediaMatch && method === 'DELETE') {
    const albumId = deleteMediaMatch[1];
    const mediaId = deleteMediaMatch[2];
    const media = await kv.get(`media:${albumId}:${mediaId}`);
    if (!media) return jsonResponse({ error: 'Media not found' }, 404);
    const deletedMedia = { ...media, deleted: true, deletedAt: new Date().toISOString(), deletedBy: user.id };
    await kv.set(`media:${albumId}:${mediaId}`, deletedMedia);
    return jsonResponse({ success: true });
  }

  // Trash
  if (path === '/trash' && method === 'GET') {
    const allAlbums = await kv.getByPrefix('album:');
    const allMedia = await kv.getByPrefix('media:');
    const deletedAlbums = allAlbums.filter((a: any) => a.deleted);
    const deletedMedia = allMedia.filter((m: any) => m.deleted);
    const mediaWithUrls = await Promise.all(deletedMedia.map(async (media: any) => {
      const res = await fetch(`${supabaseUrl}/storage/v1/object/sign/${MEDIA_BUCKET}/${media.path}`, { method: 'POST', headers: { 'apikey': supabaseServiceKey, 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
      const signedData = await res.json();
      return { ...media, url: signedData.signedURL ? `${supabaseUrl}/storage/v1${signedData.signedURL}` : '' };
    }));
    return jsonResponse({ albums: deletedAlbums, media: mediaWithUrls });
  }

  if (path === '/trash/restore' && method === 'POST') {
    const { type, id, albumId } = await req.json();
    if (type === 'album') { const album = await kv.get(`album:${id}`); if (album) await kv.set(`album:${id}`, { ...album, deleted: false }); }
    else if (type === 'media' && albumId) { const media = await kv.get(`media:${albumId}:${id}`); if (media) await kv.set(`media:${albumId}:${id}`, { ...media, deleted: false }); }
    return jsonResponse({ success: true });
  }

  if (path === '/trash/restore-all' && method === 'POST') {
    const allAlbums = await kv.getByPrefix('album:');
    const allMedia = await kv.getByPrefix('media:');
    for (const album of allAlbums.filter((a: any) => a.deleted)) await kv.set(`album:${album.id}`, { ...album, deleted: false });
    for (const media of allMedia.filter((m: any) => m.deleted)) await kv.set(`media:${media.albumId}:${media.id}`, { ...media, deleted: false });
    return jsonResponse({ success: true });
  }

  if (path.startsWith('/trash/') && method === 'DELETE') {
    const url = new URL(req.url);
    const type = path.split('/')[2];
    const id = path.split('/')[3];
    const albumId = url.searchParams.get('albumId');
    if (type === 'album') {
      const album = await kv.get(`album:${id}`);
      if (album) {
        const allMedia = await kv.getByPrefix(`media:${id}:`);
        for (const media of allMedia) { await fetch(`${supabaseUrl}/storage/v1/object/${MEDIA_BUCKET}/${media.path}`, { method: 'DELETE', headers: { 'apikey': supabaseServiceKey, 'Authorization': `Bearer ${supabaseServiceKey}` } }); await kv.del(`media:${id}:${media.id}`); }
        await kv.del(`album:${id}`);
      }
    } else if (type === 'media' && albumId) {
      const media = await kv.get(`media:${albumId}:${id}`);
      if (media) { await fetch(`${supabaseUrl}/storage/v1/object/${MEDIA_BUCKET}/${media.path}`, { method: 'DELETE', headers: { 'apikey': supabaseServiceKey, 'Authorization': `Bearer ${supabaseServiceKey}` } }); await kv.del(`media:${albumId}:${id}`); }
    }
    return jsonResponse({ success: true });
  }

  if (path === '/trash' && method === 'DELETE') {
    const allAlbums = await kv.getByPrefix('album:');
    const allMedia = await kv.getByPrefix('media:');
    for (const album of allAlbums.filter((a: any) => a.deleted)) await kv.del(`album:${album.id}`);
    for (const media of allMedia.filter((m: any) => m.deleted)) { await fetch(`${supabaseUrl}/storage/v1/object/${MEDIA_BUCKET}/${media.path}`, { method: 'DELETE', headers: { 'apikey': supabaseServiceKey, 'Authorization': `Bearer ${supabaseServiceKey}` } }); await kv.del(`media:${media.albumId}:${media.id}`); }
    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: 'Not found' }, 404);
});
