const MEDIA_CACHE_KEY = 'gallery_media_cache';

interface CachedMedia {
  id: string;
  albumId: string;
  path: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
  createdBy: string;
  deleted: boolean;
  url: string;
  cachedAt: number;
}

export const getCachedMedia = (): CachedMedia[] => {
  try {
    const cached = localStorage.getItem(MEDIA_CACHE_KEY);
    return cached ? JSON.parse(cached) : [];
  } catch {
    return [];
  }
};

export const setCachedMedia = (media: CachedMedia[]) => {
  try {
    localStorage.setItem(MEDIA_CACHE_KEY, JSON.stringify(media));
  } catch (e) {
    console.error('Error caching media:', e);
  }
};

export const getOrFetchUrl = async (path: string, cachedUrl?: string): Promise<string> => {
  if (cachedUrl && cachedUrl.startsWith('http')) {
    return cachedUrl;
  }
  
  const { data } = await supabase.storage
    .from('media')
    .createSignedUrl(path, 31536000);
  
  return data?.signedUrl || '';
};
