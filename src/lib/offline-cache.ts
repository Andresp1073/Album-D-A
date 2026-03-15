const DB_NAME = 'gallery-offline-cache';
const DB_VERSION = 1;
const STORE_NAME = 'images';

interface StoredImage {
  id: string;
  blob: Blob;
  type: string;
  cachedAt: number;
}

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

export const cacheImage = async (id: string, url: string): Promise<void> => {
  try {
    const response = await fetch(url);
    if (!response.ok) return;
    
    const blob = await response.blob();
    const imageData: StoredImage = {
      id,
      blob,
      type: blob.type,
      cachedAt: Date.now()
    };
    
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(imageData);
  } catch (error) {
    console.error('Error caching image:', error);
  }
};

export const getCachedImage = async (id: string): Promise<string | null> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    
    return new Promise((resolve) => {
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result) {
          const url = URL.createObjectURL(request.result.blob);
          resolve(url);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
};

export const getAllCachedImageIds = async (): Promise<string[]> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    
    return new Promise((resolve) => {
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
};

export const cacheImagesInBackground = async (media: { id: string; url: string }[]): Promise<void> => {
  const cachedIds = await getAllCachedImageIds();
  
  for (const item of media) {
    if (!cachedIds.includes(item.id) && item.url) {
      await cacheImage(item.id, item.url);
    }
  }
};
