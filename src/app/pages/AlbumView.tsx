import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router";
import { ArrowLeft, Upload, Image as ImageIcon, Play, Trash2, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { supabase } from "../../lib/supabase";
import { Album, Media } from "../../types";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

const MEDIA_CACHE_KEY = 'gallery_media_cache';

const getCachedMedia = (): Media[] => {
  try {
    const cached = localStorage.getItem(MEDIA_CACHE_KEY);
    return cached ? JSON.parse(cached) : [];
  } catch {
    return [];
  }
};

const setCachedMedia = (media: Media[]) => {
  try {
    localStorage.setItem(MEDIA_CACHE_KEY, JSON.stringify(media));
  } catch (e) {
    console.error('Error caching media:', e);
  }
};

function FullscreenViewer({ media, initialIndex, onClose, onDelete, onIndexChange }: { media: Media[]; initialIndex: number; onClose: () => void; onDelete: (media: Media) => void; onIndexChange?: (index: number) => void }) {
  const [index, setIndex] = useState(initialIndex);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  useEffect(() => {
    setIndex(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") {
        const newIndex = index > 0 ? index - 1 : media.length - 1;
        setIndex(newIndex);
        onIndexChange?.(newIndex);
      }
      else if (e.key === "ArrowRight") {
        const newIndex = index < media.length - 1 ? index + 1 : 0;
        setIndex(newIndex);
        onIndexChange?.(newIndex);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "auto";
    };
  }, [media.length, onClose, index]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  
  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };
  
  const handleTouchEnd = () => {
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) > 50) {
      let newIndex: number;
      if (diff > 0) {
        newIndex = index < media.length - 1 ? index + 1 : 0;
      } else {
        newIndex = index > 0 ? index - 1 : media.length - 1;
      }
      setIndex(newIndex);
      onIndexChange?.(newIndex);
    }
  };

  const current = media[index];
  const isVideo = current?.type.startsWith("video/");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Close button */}
      <button onClick={onClose} className="absolute top-4 right-4 z-20 p-2 text-white/80 hover:text-white transition-colors">
        <X className="w-8 h-8" />
      </button>

      {/* Counter */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 text-white font-medium bg-black/30 backdrop-blur-sm px-4 py-2 rounded-full text-sm">
        {index + 1} / {media.length}
      </div>

      {/* Navigation arrows - hide on mobile */}
      {media.length > 1 && (
        <>
          <button 
            onClick={(e) => { e.stopPropagation(); setIndex(i => i > 0 ? i - 1 : media.length - 1); }}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-20 p-3 text-white/70 hover:text-white transition-colors bg-black/20 hover:bg-black/40 rounded-full hidden md:flex"
          >
            <ChevronLeft className="w-8 h-8" />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); setIndex(i => i < media.length - 1 ? i + 1 : 0); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-20 p-3 text-white/70 hover:text-white transition-colors bg-black/20 hover:bg-black/40 rounded-full hidden md:flex"
          >
            <ChevronRight className="w-8 h-8" />
          </button>
        </>
      )}

      {/* Media */}
      <div className="max-w-full max-h-full p-0 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video src={current.url} controls autoPlay className="max-w-full max-h-[90vh] object-contain" />
        ) : (
          <img src={current.url} alt={current.name} className="max-w-full max-h-[90vh] object-contain" />
        )}
      </div>

      {/* Delete button */}
      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20">
        <button 
          onClick={(e) => { e.stopPropagation(); onDelete(current); }} 
          className="p-3 bg-red-600 hover:bg-red-700 rounded-full text-white flex items-center gap-2"
        >
          <Trash2 className="w-6 h-6" />
        </button>
      </div>
    </motion.div>
  );
}

export default function AlbumView() {
  const { id } = useParams();
  const [album, setAlbum] = useState<Album | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<Media | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (id) {
      loadAlbum();
      loadMedia();
    }
  }, [id]);

  const loadAlbum = async () => {
    try {
      const { data, error } = await supabase
        .from('albums')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      
      if (data) {
        setAlbum({
          id: data.id,
          name: data.name,
          description: data.description || '',
          coverUrl: data.cover_url,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
          createdBy: data.created_by,
          deleted: data.deleted
        });
      }
    } catch (error) {
      console.error("Error loading album:", error);
    }
  };

  const loadMedia = async () => {
    const cachedMedia = getCachedMedia();
    const albumCachedMedia = cachedMedia.filter(m => m.albumId === id);
    
    if (albumCachedMedia.length > 0) {
      setMedia(albumCachedMedia);
      setLoading(false);
    }
    
    try {
      const { data, error } = await supabase
        .from('media')
        .select('*')
        .eq('album_id', id)
        .eq('deleted', false)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const newMedia: Media[] = [];
      for (const item of (data || [])) {
        const cached = albumCachedMedia.find(m => m.id === item.id);
        if (cached?.url) {
          newMedia.push(cached);
        } else {
          try {
            const { data: { signedUrl } } = await supabase.storage.from('media').createSignedUrl(item.path, 31536000);
            newMedia.push({ id: item.id, albumId: item.album_id, path: item.path, name: item.name, type: item.type, size: item.size, createdAt: item.created_at, createdBy: item.created_by, deleted: item.deleted, url: signedUrl || '' });
          } catch {
            newMedia.push({ id: item.id, albumId: item.album_id, path: item.path, name: item.name, type: item.type, size: item.size, createdAt: item.created_at, createdBy: item.created_by, deleted: item.deleted, url: '' });
          }
        }
      }

      setMedia(newMedia);
      
      const allCached = getCachedMedia();
      const updatedCache = [...allCached.filter(m => m.albumId !== id), ...newMedia];
      setCachedMedia(updatedCache);
    } catch (error) {
      console.error("Error loading media:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !id) return;

    setUploading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user');

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = `${Date.now()}-${file.name}`;
        
        const { error: uploadError } = await supabase.storage
          .from('media')
          .upload(`${id}/${fileName}`, file);

        if (uploadError) throw uploadError;

        const { error: dbError } = await supabase.from('media').insert({
          album_id: id,
          path: `${id}/${fileName}`,
          name: file.name,
          type: file.type,
          size: file.size,
          created_by: user.id
        });

        if (dbError) throw dbError;
      }

      toast.success(`${files.length} ${files.length === 1 ? 'archivo subido' : 'archivos subidos'}`);
      loadMedia();
    } catch (error) {
      console.error("Error uploading files:", error);
      toast.error("Error al subir archivos");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDeleteMedia = async () => {
    if (!selectedMedia) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user');

      const { error } = await supabase
        .from('media')
        .update({ 
          deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: user.id
        })
        .eq('id', selectedMedia.id);

      if (error) throw error;

      toast.success("Foto movida a la papelera");
      setDeleteDialogOpen(false);
      setSelectedMedia(null);
      loadMedia();
    } catch (error) {
      console.error("Error deleting media:", error);
      toast.error("Error al eliminar la foto");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-rose-200 border-t-rose-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!album) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-600">Álbum no encontrado</p>
        <Link to="/">
          <Button className="mt-4">Volver</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AnimatePresence>
        {viewerOpen && media.length > 0 && (
          <FullscreenViewer media={media} initialIndex={viewerIndex} onClose={() => setViewerOpen(false)} onDelete={(media) => { setSelectedMedia(media); setDeleteDialogOpen(true); }} onIndexChange={(index) => setViewerIndex(index)} />
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Link to="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Volver
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-rose-600 to-pink-600 bg-clip-text text-transparent">
              {album.name}
            </h1>
            {album.description && (
              <p className="text-gray-600 mt-1">{album.description}</p>
            )}
            <p className="text-sm text-gray-500 mt-1">
              {media.length} {media.length === 1 ? "archivo" : "archivos"}
            </p>
          </div>
        </div>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="gap-2 bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 shadow-lg"
          >
            {uploading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Subiendo...
              </>
            ) : (
              <>
                <Upload className="w-5 h-5" />
                Subir fotos/videos
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Gallery Grid */}
      {media.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-20"
        >
          <ImageIcon className="w-20 h-20 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-700 mb-2">
            No hay fotos todavía
          </h3>
          <p className="text-gray-500 mb-6">
            Empieza a subir tus fotos y videos favoritos
          </p>
          <Button
            onClick={() => fileInputRef.current?.click()}
            className="gap-2 bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700"
          >
            <Upload className="w-5 h-5" />
            Subir archivos
          </Button>
        </motion.div>
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {media.map((item, index) => {
            const isVideo = item.type.startsWith("video/");
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.02 }}
                className="group relative aspect-square bg-gray-100 overflow-hidden cursor-pointer"
                onClick={() => { setViewerIndex(index); setViewerOpen(true); }}
              >
                {isVideo ? (
                  <div className="relative w-full h-full">
                    <video
                      src={item.url}
                      className="w-full h-full object-cover"
                      muted
                      onMouseOver={(e) => e.currentTarget.play()}
                      onMouseOut={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                    />
                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play className="w-12 h-12 text-white drop-shadow-lg" />
                    </div>
                  </div>
                ) : (
                  <img
                    src={item.url}
                    alt={item.name}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                  />
                )}

                {/* Delete button on hover */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-10 w-10 p-0 rounded-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedMedia(item);
                      setDeleteDialogOpen(true);
                    }}
                  >
                    <Trash2 className="w-5 h-5" />
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Mover a la papelera?</AlertDialogTitle>
            <AlertDialogDescription>
              Este archivo se moverá a la papelera. Podrás recuperarlo más tarde.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteMedia}
              className="bg-red-600 hover:bg-red-700"
            >
              Mover a papelera
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
