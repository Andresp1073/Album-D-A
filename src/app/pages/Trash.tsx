import { useState, useEffect, useRef } from "react";
import { Trash2, RotateCcw, AlertTriangle, Image as ImageIcon, X, ChevronLeft, ChevronRight, Play } from "lucide-react";
import { Button } from "../components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { supabase } from "../../lib/supabase";
import { Album, Media } from "../../types";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

function FullscreenViewer({ media, initialIndex, onClose }: { media: Media[]; initialIndex: number; onClose: () => void }) {
  const [index, setIndex] = useState(initialIndex);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  useEffect(() => {
    setIndex(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setIndex(i => i > 0 ? i - 1 : media.length - 1);
      else if (e.key === "ArrowRight") setIndex(i => i < media.length - 1 ? i + 1 : 0);
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
      if (diff > 0) {
        setIndex(i => i < media.length - 1 ? i + 1 : 0);
      } else {
        setIndex(i => i > 0 ? i - 1 : media.length - 1);
      }
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
      <button onClick={onClose} className="absolute top-4 right-4 z-20 p-2 text-white/80 hover:text-white transition-colors">
        <X className="w-8 h-8" />
      </button>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 text-white font-medium bg-black/30 backdrop-blur-sm px-4 py-2 rounded-full text-sm">
        {index + 1} / {media.length}
      </div>
      {media.length > 1 && (
        <>
          <button onClick={(e) => { e.stopPropagation(); setIndex(i => i > 0 ? i - 1 : media.length - 1); }} className="absolute left-2 top-1/2 -translate-y-1/2 z-20 p-3 text-white/70 hover:text-white transition-colors bg-black/20 hover:bg-black/40 rounded-full hidden md:flex">
            <ChevronLeft className="w-8 h-8" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); setIndex(i => i < media.length - 1 ? i + 1 : 0); }} className="absolute right-2 top-1/2 -translate-y-1/2 z-20 p-3 text-white/70 hover:text-white transition-colors bg-black/20 hover:bg-black/40 rounded-full hidden md:flex">
            <ChevronRight className="w-8 h-8" />
          </button>
        </>
      )}
      <div className="max-w-full max-h-full p-0 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video src={current.url} controls autoPlay className="max-w-full max-h-[90vh] object-contain" />
        ) : (
          <img src={current.url} alt={current.name} className="max-w-full max-h-[90vh] object-contain" />
        )}
      </div>
    </motion.div>
  );
}

export default function Trash() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [emptyTrashDialogOpen, setEmptyTrashDialogOpen] = useState(false);
  const [restoreAllDialogOpen, setRestoreAllDialogOpen] = useState(false);
  const [deleteItemDialogOpen, setDeleteItemDialogOpen] = useState(false);
  const [restoreItemDialogOpen, setRestoreItemDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<{ type: string; id: string; albumId?: string; name?: string } | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  useEffect(() => {
    loadTrash();
  }, []);

  const loadTrash = async () => {
    try {
      // Load deleted albums
      const { data: albumsData, error: albumsError } = await supabase
        .from('albums')
        .select('*')
        .eq('deleted', true);

      if (albumsError) throw albumsError;

      // Load deleted media
      const { data: mediaData, error: mediaError } = await supabase
        .from('media')
        .select('*')
        .eq('deleted', true);

      if (mediaError) throw mediaError;

      const albumsFormatted = (albumsData || []).map(album => ({
        id: album.id,
        name: album.name,
        description: album.description || '',
        coverUrl: album.cover_url,
        createdAt: album.created_at,
        updatedAt: album.updated_at,
        createdBy: album.created_by,
        deleted: album.deleted,
        deletedAt: album.deleted_at,
        deletedBy: album.deleted_by
      }));

      const mediaWithUrls = await Promise.all(
        (mediaData || []).map(async (item) => {
          const { data: { signedUrl } } = await supabase.storage
            .from('media')
            .createSignedUrl(item.path, 31536000);
          
          return {
            id: item.id,
            albumId: item.album_id,
            path: item.path,
            name: item.name,
            type: item.type,
            size: item.size,
            createdAt: item.created_at,
            createdBy: item.created_by,
            deleted: item.deleted,
            deletedAt: item.deleted_at,
            deletedBy: item.deleted_by,
            url: signedUrl || ''
          };
        })
      );

      setAlbums(albumsFormatted);
      setMedia(mediaWithUrls);
    } catch (error) {
      console.error("Error loading trash:", error);
      toast.error("Error al cargar la papelera");
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreItem = async () => {
    if (!selectedItem) return;

    try {
      const { type, id, albumId } = selectedItem;

      if (type === 'album') {
        const { error } = await supabase
          .from('albums')
          .update({ deleted: false, deleted_at: null, deleted_by: null })
          .eq('id', id);
        if (error) throw error;
      } else if (type === 'media' && albumId) {
        const { error } = await supabase
          .from('media')
          .update({ deleted: false, deleted_at: null, deleted_by: null })
          .eq('id', id);
        if (error) throw error;
      }

      toast.success("Elemento restaurado exitosamente");
      setRestoreItemDialogOpen(false);
      setSelectedItem(null);
      loadTrash();
    } catch (error) {
      console.error("Error restoring item:", error);
      toast.error("Error al restaurar el elemento");
    }
  };

  const handleRestoreAll = async () => {
    try {
      // Restore all albums
      for (const album of albums) {
        const { error } = await supabase
          .from('albums')
          .update({ deleted: false, deleted_at: null, deleted_by: null })
          .eq('id', album.id);
        if (error) throw error;
      }

      // Restore all media
      for (const item of media) {
        const { error } = await supabase
          .from('media')
          .update({ deleted: false, deleted_at: null, deleted_by: null })
          .eq('id', item.id);
        if (error) throw error;
      }

      toast.success("Todos los elementos restaurados");
      setRestoreAllDialogOpen(false);
      loadTrash();
    } catch (error) {
      console.error("Error restoring all:", error);
      toast.error("Error al restaurar los elementos");
    }
  };

  const handleDeleteItemPermanently = async () => {
    if (!selectedItem) return;

    try {
      const { type, id, albumId } = selectedItem;

      if (type === 'album') {
        // Delete all media in album first
        const { data: mediaToDelete } = await supabase
          .from('media')
          .select('path')
          .eq('album_id', id);

        if (mediaToDelete) {
          for (const item of mediaToDelete) {
            await supabase.storage.from('media').remove([item.path]);
          }
        }

        // Delete media records
        await supabase.from('media').delete().eq('album_id', id);

        // Delete album
        const { error } = await supabase.from('albums').delete().eq('id', id);
        if (error) throw error;
      } else if (type === 'media' && albumId) {
        // Get media path
        const { data: mediaItem } = await supabase
          .from('media')
          .select('path')
          .eq('id', id)
          .single();

        if (mediaItem) {
          await supabase.storage.from('media').remove([mediaItem.path]);
        }

        const { error } = await supabase.from('media').delete().eq('id', id);
        if (error) throw error;
      }

      toast.success("Elemento eliminado permanentemente");
      setDeleteItemDialogOpen(false);
      setSelectedItem(null);
      loadTrash();
    } catch (error) {
      console.error("Error deleting item permanently:", error);
      toast.error("Error al eliminar el elemento");
    }
  };

  const handleEmptyTrash = async () => {
    try {
      // Delete all deleted albums
      for (const album of albums) {
        // Delete all media in album
        const { data: mediaToDelete } = await supabase
          .from('media')
          .select('path')
          .eq('album_id', album.id);

        if (mediaToDelete) {
          for (const item of mediaToDelete) {
            await supabase.storage.from('media').remove([item.path]);
          }
        }

        await supabase.from('media').delete().eq('album_id', album.id);
        await supabase.from('albums').delete().eq('id', album.id);
      }

      // Delete all deleted media
      for (const item of media) {
        await supabase.storage.from('media').remove([item.path]);
        await supabase.from('media').delete().eq('id', item.id);
      }

      toast.success("Papelera vaciada");
      setEmptyTrashDialogOpen(false);
      loadTrash();
    } catch (error) {
      console.error("Error emptying trash:", error);
      toast.error("Error al vaciar la papelera");
    }
  };

  const openDeleteDialog = (type: string, id: string, albumId?: string) => {
    setSelectedItem({ type, id, albumId });
    setDeleteItemDialogOpen(true);
  };

  const openRestoreDialog = (type: string, id: string, albumId?: string, name?: string) => {
    setSelectedItem({ type, id, albumId, name });
    setRestoreItemDialogOpen(true);
  };

  const totalItems = albums.length + media.length;

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

  return (
    <div className="space-y-6">
      <AnimatePresence>
        {viewerOpen && (
          <FullscreenViewer media={media} initialIndex={viewerIndex} onClose={() => setViewerOpen(false)} />
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-rose-600 to-pink-600 bg-clip-text text-transparent">
            Papelera
          </h1>
          <p className="text-gray-600 mt-1">
            {totalItems} {totalItems === 1 ? "elemento" : "elementos"}
          </p>
        </div>

        {totalItems > 0 && (
          <div className="flex gap-2">
            <Button
              onClick={() => setRestoreAllDialogOpen(true)}
              variant="outline"
              className="gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Restaurar todo
            </Button>
            <Button
              onClick={() => setEmptyTrashDialogOpen(true)}
              variant="destructive"
              className="gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Vaciar papelera
            </Button>
          </div>
        )}
      </div>

      {/* Empty State */}
      {totalItems === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-20"
        >
          <Trash2 className="w-20 h-20 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-700 mb-2">
            La papelera está vacía
          </h3>
          <p className="text-gray-500">
            No hay elementos eliminados
          </p>
        </motion.div>
      ) : (
        <div className="space-y-8">
          {/* Deleted Albums */}
          {albums.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-800">
                Álbumes ({albums.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {albums.map((album, index) => (
                  <motion.div
                    key={album.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="bg-white rounded-2xl shadow-lg overflow-hidden border border-red-100"
                  >
                    <div className="aspect-square bg-gradient-to-br from-red-100 to-pink-100 flex items-center justify-center">
                      {album.coverUrl ? (
                        <img
                          src={album.coverUrl}
                          alt={album.name}
                          className="w-full h-full object-cover opacity-60"
                        />
                      ) : (
                        <ImageIcon className="w-16 h-16 text-red-300" />
                      )}
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {album.name}
                      </h3>
                      {album.description && (
                        <p className="text-sm text-gray-500 truncate mt-1">
                          {album.description}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-2">
                        Eliminado el {new Date(album.deletedAt!).toLocaleDateString('es-ES')}
                      </p>
                      <div className="flex gap-2 mt-4">
                        <Button
                          size="sm"
                          onClick={() => openRestoreDialog("album", album.id, undefined, album.name)}
                          className="flex-1 gap-1 bg-green-600 hover:bg-green-700"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Restaurar
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => openDeleteDialog("album", album.id)}
                          className="flex-1 gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          Eliminar
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* Deleted Media */}
          {media.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-800">
                Fotos y videos ({media.length})
              </h2>
              <div className="grid grid-cols-3 gap-1">
                {media.map((item, index) => {
                  const isVideo = item.type.startsWith("video/");
                  return (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.02 }}
                      className="group relative aspect-square bg-gray-100 rounded-lg overflow-hidden cursor-pointer"
                      onClick={() => { setViewerIndex(index); setViewerOpen(true); }}
                    >
                      {isVideo ? (
                        <video
                          src={item.url}
                          className="w-full h-full object-cover opacity-60"
                        />
                      ) : (
                        <img
                          src={item.url}
                          alt={item.name}
                          className="w-full h-full object-cover opacity-60"
                        />
                      )}

                      {/* Overlay with actions */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-2">
                        <Button
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); openRestoreDialog("media", item.id, item.albumId, item.name); }}
                          className="bg-green-600 hover:bg-green-700 h-8 px-2"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={(e) => { e.stopPropagation(); openDeleteDialog("media", item.id, item.albumId); }}
                          className="h-8 px-2"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Restore All Confirmation */}
      <AlertDialog open={restoreAllDialogOpen} onOpenChange={setRestoreAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Restaurar todo?</AlertDialogTitle>
            <AlertDialogDescription>
              Se restaurarán todos los elementos de la papelera ({totalItems} elementos).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRestoreAll}
              className="bg-green-600 hover:bg-green-700"
            >
              Restaurar todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Empty Trash Confirmation */}
      <AlertDialog open={emptyTrashDialogOpen} onOpenChange={setEmptyTrashDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              ¿Vaciar papelera permanentemente?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Todos los elementos de la papelera ({totalItems} elementos) 
              serán eliminados permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleEmptyTrash}
              className="bg-red-600 hover:bg-red-700"
            >
              Vaciar papelera
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Item Permanently Confirmation */}
      <AlertDialog open={deleteItemDialogOpen} onOpenChange={setDeleteItemDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              ¿Eliminar permanentemente?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El elemento será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteItemPermanently}
              className="bg-red-600 hover:bg-red-700"
            >
              Eliminar permanentemente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore Item Confirmation */}
      <AlertDialog open={restoreItemDialogOpen} onOpenChange={setRestoreItemDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Restaurar elemento?</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que quieres restaurar "{selectedItem?.name || 'este elemento'}"?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRestoreItem}
              className="bg-green-600 hover:bg-green-700"
            >
              Restaurar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
