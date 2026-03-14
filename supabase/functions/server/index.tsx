import { Hono } from "jsr:@hono/hono";
import { cors } from "jsr:@hono/hono/cors";
import { logger } from "jsr:@hono/hono/logger";
import * as kv from "./kv_store.tsx";
import { createClient } from "jsr:@supabase/supabase-js@2";

const app = new Hono();

// Supabase client with service role for admin operations
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

// Lista blanca de usuarios autorizados (emails)
const AUTHORIZED_USERS = [
  Deno.env.get('USER_1_EMAIL') ?? '',
  Deno.env.get('USER_2_EMAIL') ?? '',
];

// Bucket names
const MEDIA_BUCKET = 'make-13a04c32-media';
const THUMBNAILS_BUCKET = 'make-13a04c32-thumbnails';

// Initialize storage buckets on startup
const initStorage = async () => {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    
    if (!buckets?.some(bucket => bucket.name === MEDIA_BUCKET)) {
      await supabase.storage.createBucket(MEDIA_BUCKET, { public: false });
      console.log(`Created bucket: ${MEDIA_BUCKET}`);
    }
    
    if (!buckets?.some(bucket => bucket.name === THUMBNAILS_BUCKET)) {
      await supabase.storage.createBucket(THUMBNAILS_BUCKET, { public: false });
      console.log(`Created bucket: ${THUMBNAILS_BUCKET}`);
    }
  } catch (error) {
    console.error('Error initializing storage:', error);
  }
};

initStorage();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Health check endpoint
app.get("/make-server-13a04c32/health", (c) => {
  return c.json({ status: "ok" });
});

// ========== AUTHENTICATION ROUTES ==========

// Sign up - creates user only if email is in authorized list
app.post("/make-server-13a04c32/auth/signup", async (c) => {
  try {
    const { email, password, name } = await c.req.json();
    
    // Verify email is in authorized list
    if (!AUTHORIZED_USERS.includes(email)) {
      console.error(`Signup attempt with unauthorized email: ${email}`);
      return c.json({ error: 'Unauthorized email address' }, 403);
    }
    
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name },
      // Automatically confirm email since email server not configured
      email_confirm: true
    });
    
    if (error) {
      console.error('Error creating user during signup:', error);
      return c.json({ error: error.message }, 400);
    }
    
    return c.json({ user: data.user });
  } catch (error) {
    console.error('Signup error:', error);
    return c.json({ error: 'Signup failed' }, 500);
  }
});

// Sign in - verifies user is authorized
app.post("/make-server-13a04c32/auth/signin", async (c) => {
  try {
    const { email, password } = await c.req.json();
    
    // Verify email is in authorized list
    if (!AUTHORIZED_USERS.includes(email)) {
      console.error(`Signin attempt with unauthorized email: ${email}`);
      return c.json({ error: 'Unauthorized email address' }, 403);
    }
    
    // Create temporary client for sign in
    const clientSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    );
    
    const { data, error } = await clientSupabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) {
      console.error('Error signing in user:', error);
      return c.json({ error: error.message }, 400);
    }
    
    return c.json({ 
      access_token: data.session?.access_token,
      user: data.user 
    });
  } catch (error) {
    console.error('Signin error:', error);
    return c.json({ error: 'Signin failed' }, 500);
  }
});

// Get session
app.get("/make-server-13a04c32/auth/session", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    
    if (!accessToken) {
      return c.json({ session: null }, 401);
    }
    
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    
    if (error || !user) {
      console.error('Error getting session:', error);
      return c.json({ session: null }, 401);
    }
    
    // Double check user is authorized
    if (!AUTHORIZED_USERS.includes(user.email ?? '')) {
      console.error(`Session check failed for unauthorized user: ${user.email}`);
      return c.json({ error: 'Unauthorized user' }, 403);
    }
    
    return c.json({ user });
  } catch (error) {
    console.error('Session check error:', error);
    return c.json({ error: 'Session check failed' }, 500);
  }
});

// ========== ALBUM ROUTES ==========

// Get all albums (not in trash)
app.get("/make-server-13a04c32/albums", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    if (!AUTHORIZED_USERS.includes(user.email ?? '')) {
      return c.json({ error: 'Unauthorized user' }, 403);
    }
    
    const albums = await kv.getByPrefix('album:');
    const filteredAlbums = albums
      .filter((a: any) => !a.deleted)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    return c.json({ albums: filteredAlbums });
  } catch (error) {
    console.error('Error fetching albums:', error);
    return c.json({ error: 'Failed to fetch albums' }, 500);
  }
});

// Create album
app.post("/make-server-13a04c32/albums", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    if (!AUTHORIZED_USERS.includes(user.email ?? '')) {
      return c.json({ error: 'Unauthorized user' }, 403);
    }
    
    const { name, description, coverUrl } = await c.req.json();
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
    
    return c.json({ album });
  } catch (error) {
    console.error('Error creating album:', error);
    return c.json({ error: 'Failed to create album' }, 500);
  }
});

// Update album
app.put("/make-server-13a04c32/albums/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    if (!AUTHORIZED_USERS.includes(user.email ?? '')) {
      return c.json({ error: 'Unauthorized user' }, 403);
    }
    
    const albumId = c.req.param('id');
    const updates = await c.req.json();
    
    const existingAlbum = await kv.get(`album:${albumId}`);
    if (!existingAlbum) {
      return c.json({ error: 'Album not found' }, 404);
    }
    
    const updatedAlbum = {
      ...existingAlbum,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    
    await kv.set(`album:${albumId}`, updatedAlbum);
    
    return c.json({ album: updatedAlbum });
  } catch (error) {
    console.error('Error updating album:', error);
    return c.json({ error: 'Failed to update album' }, 500);
  }
});

// Delete album (move to trash)
app.delete("/make-server-13a04c32/albums/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    if (!AUTHORIZED_USERS.includes(user.email ?? '')) {
      return c.json({ error: 'Unauthorized user' }, 403);
    }
    
    const albumId = c.req.param('id');
    const album = await kv.get(`album:${albumId}`);
    
    if (!album) {
      return c.json({ error: 'Album not found' }, 404);
    }
    
    const deletedAlbum = {
      ...album,
      deleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy: user.id,
    };
    
    await kv.set(`album:${albumId}`, deletedAlbum);
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting album:', error);
    return c.json({ error: 'Failed to delete album' }, 500);
  }
});

// ========== MEDIA ROUTES ==========

// Get media for an album
app.get("/make-server-13a04c32/albums/:id/media", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    if (!AUTHORIZED_USERS.includes(user.email ?? '')) {
      return c.json({ error: 'Unauthorized user' }, 403);
    }
    
    const albumId = c.req.param('id');
    const allMedia = await kv.getByPrefix(`media:${albumId}:`);
    
    const filteredMedia = allMedia
      .filter((m: any) => !m.deleted)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    // Generate signed URLs for each media
    const mediaWithUrls = await Promise.all(
      filteredMedia.map(async (media: any) => {
        const { data: urlData } = await supabase.storage
          .from(MEDIA_BUCKET)
          .createSignedUrl(media.path, 3600); // 1 hour expiry
        
        return {
          ...media,
          url: urlData?.signedUrl || '',
        };
      })
    );
    
    return c.json({ media: mediaWithUrls });
  } catch (error) {
    console.error('Error fetching media:', error);
    return c.json({ error: 'Failed to fetch media' }, 500);
  }
});

// Upload media
app.post("/make-server-13a04c32/albums/:id/media", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    if (!AUTHORIZED_USERS.includes(user.email ?? '')) {
      return c.json({ error: 'Unauthorized user' }, 403);
    }
    
    const albumId = c.req.param('id');
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }
    
    const mediaId = crypto.randomUUID();
    const fileExt = file.name.split('.').pop();
    const filePath = `${albumId}/${mediaId}.${fileExt}`;
    
    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(filePath, await file.arrayBuffer(), {
        contentType: file.type,
      });
    
    if (uploadError) {
      console.error('Error uploading file to storage:', uploadError);
      return c.json({ error: 'Failed to upload file' }, 500);
    }
    
    // Save metadata to KV store
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
    const { data: urlData } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(filePath, 3600);
    
    return c.json({ 
      media: {
        ...media,
        url: urlData?.signedUrl || '',
      }
    });
  } catch (error) {
    console.error('Error uploading media:', error);
    return c.json({ error: 'Failed to upload media' }, 500);
  }
});

// Delete media (move to trash)
app.delete("/make-server-13a04c32/media/:albumId/:mediaId", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    if (!AUTHORIZED_USERS.includes(user.email ?? '')) {
      return c.json({ error: 'Unauthorized user' }, 403);
    }
    
    const albumId = c.req.param('albumId');
    const mediaId = c.req.param('mediaId');
    
    const media = await kv.get(`media:${albumId}:${mediaId}`);
    
    if (!media) {
      return c.json({ error: 'Media not found' }, 404);
    }
    
    const deletedMedia = {
      ...media,
      deleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy: user.id,
    };
    
    await kv.set(`media:${albumId}:${mediaId}`, deletedMedia);
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting media:', error);
    return c.json({ error: 'Failed to delete media' }, 500);
  }
});

// ========== TRASH ROUTES ==========

// Get all trash items
app.get("/make-server-13a04c32/trash", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    if (!AUTHORIZED_USERS.includes(user.email ?? '')) {
      return c.json({ error: 'Unauthorized user' }, 403);
    }
    
    const allAlbums = await kv.getByPrefix('album:');
    const allMedia = await kv.getByPrefix('media:');
    
    const deletedAlbums = allAlbums.filter((a: any) => a.deleted);
    const deletedMedia = allMedia.filter((m: any) => m.deleted);
    
    // Generate signed URLs for deleted media
    const mediaWithUrls = await Promise.all(
      deletedMedia.map(async (media: any) => {
        const { data: urlData } = await supabase.storage
          .from(MEDIA_BUCKET)
          .createSignedUrl(media.path, 3600);
        
        return {
          ...media,
          url: urlData?.signedUrl || '',
        };
      })
    );
    
    return c.json({ 
      albums: deletedAlbums,
      media: mediaWithUrls,
    });
  } catch (error) {
    console.error('Error fetching trash:', error);
    return c.json({ error: 'Failed to fetch trash' }, 500);
  }
});

// Restore item from trash
app.post("/make-server-13a04c32/trash/restore", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    if (!AUTHORIZED_USERS.includes(user.email ?? '')) {
      return c.json({ error: 'Unauthorized user' }, 403);
    }
    
    const { type, id, albumId } = await c.req.json();
    
    if (type === 'album') {
      const album = await kv.get(`album:${id}`);
      if (album) {
        await kv.set(`album:${id}`, { ...album, deleted: false });
      }
    } else if (type === 'media') {
      const media = await kv.get(`media:${albumId}:${id}`);
      if (media) {
        await kv.set(`media:${albumId}:${id}`, { ...media, deleted: false });
      }
    }
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error restoring item:', error);
    return c.json({ error: 'Failed to restore item' }, 500);
  }
});

// Restore all items from trash
app.post("/make-server-13a04c32/trash/restore-all", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    if (!AUTHORIZED_USERS.includes(user.email ?? '')) {
      return c.json({ error: 'Unauthorized user' }, 403);
    }
    
    const allAlbums = await kv.getByPrefix('album:');
    const allMedia = await kv.getByPrefix('media:');
    
    const deletedAlbums = allAlbums.filter((a: any) => a.deleted);
    const deletedMedia = allMedia.filter((m: any) => m.deleted);
    
    // Restore all albums
    for (const album of deletedAlbums) {
      await kv.set(`album:${album.id}`, { ...album, deleted: false });
    }
    
    // Restore all media
    for (const media of deletedMedia) {
      await kv.set(`media:${media.albumId}:${media.id}`, { ...media, deleted: false });
    }
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error restoring all items:', error);
    return c.json({ error: 'Failed to restore all items' }, 500);
  }
});

// Delete item permanently
app.delete("/make-server-13a04c32/trash/:type/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    if (!AUTHORIZED_USERS.includes(user.email ?? '')) {
      return c.json({ error: 'Unauthorized user' }, 403);
    }
    
    const type = c.req.param('type');
    const id = c.req.param('id');
    const albumId = c.req.query('albumId');
    
    if (type === 'album') {
      const album = await kv.get(`album:${id}`);
      if (album) {
        // Delete all media in this album from storage
        const allMedia = await kv.getByPrefix(`media:${id}:`);
        for (const media of allMedia) {
          await supabase.storage.from(MEDIA_BUCKET).remove([media.path]);
          await kv.del(`media:${id}:${media.id}`);
        }
        await kv.del(`album:${id}`);
      }
    } else if (type === 'media' && albumId) {
      const media = await kv.get(`media:${albumId}:${id}`);
      if (media) {
        await supabase.storage.from(MEDIA_BUCKET).remove([media.path]);
        await kv.del(`media:${albumId}:${id}`);
      }
    }
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error permanently deleting item:', error);
    return c.json({ error: 'Failed to permanently delete item' }, 500);
  }
});

// Empty trash
app.delete("/make-server-13a04c32/trash", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    if (!AUTHORIZED_USERS.includes(user.email ?? '')) {
      return c.json({ error: 'Unauthorized user' }, 403);
    }
    
    const allAlbums = await kv.getByPrefix('album:');
    const allMedia = await kv.getByPrefix('media:');
    
    const deletedAlbums = allAlbums.filter((a: any) => a.deleted);
    const deletedMedia = allMedia.filter((m: any) => m.deleted);
    
    // Delete all albums permanently
    for (const album of deletedAlbums) {
      await kv.del(`album:${album.id}`);
    }
    
    // Delete all media files and metadata permanently
    for (const media of deletedMedia) {
      await supabase.storage.from(MEDIA_BUCKET).remove([media.path]);
      await kv.del(`media:${media.albumId}:${media.id}`);
    }
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error emptying trash:', error);
    return c.json({ error: 'Failed to empty trash' }, 500);
  }
});

Deno.serve(app.fetch);