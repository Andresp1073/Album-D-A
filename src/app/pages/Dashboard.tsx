import { useState, useEffect, useRef } from "react";
import { Link } from "react-router";
import { Plus, Image as ImageIcon, MoreVertical, Edit, Trash2, Grid, Folder, X, ChevronLeft, ChevronRight, Play } from "lucide-react";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
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

function FullscreenViewer({ media, initialIndex, onClose, onDelete }: { media: Media[]; initialIndex: number; onClose: () => void; onDelete: (media: Media) => void }) {
  const [index, setIndex] = useState(initialIndex);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

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
  }, [media.length, onClose]);

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
      <Button variant="ghost" size="sm" className="absolute top-4 right-4 z-20 text-white hover:bg-white/10" onClick={onClose}>
        <X className="w-6 h-6" />
      </Button>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 text-white font-medium bg-black/50 px-3 py-1 rounded-full text-sm">
        {index + 1} / {media.length}
      </div>
      {media.length > 1 && (
        <>
          <Button variant="ghost" className="absolute left-2 top-1/2 -translate-y-1/2 text-white hover:bg-white/10 h-12 w-12 rounded-full hidden md:flex" onClick={(e) => { e.stopPropagation(); setIndex(i => i > 0 ? i - 1 : media.length - 1); }}>
            <ChevronLeft className="w-8 h-8" />
          </Button>
          <Button variant="ghost" className="absolute right-2 top-1/2 -translate-y-1/2 text-white hover:bg-white/10 h-12 w-12 rounded-full hidden md:flex" onClick={(e) => { e.stopPropagation(); setIndex(i => i < media.length - 1 ? i + 1 : 0); }}>
            <ChevronRight className="w-8 h-8" />
          </Button>
        </>
      )}
      <div className="max-w-full max-h-full p-0 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video src={current.url} controls autoPlay className="max-w-full max-h-[90vh] object-contain" />
        ) : (
          <img src={current.url} alt={current.name} className="max-w-full max-h-[90vh] object-contain" />
        )}
      </div>
      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex gap-4">
        <button onClick={(e) => { e.stopPropagation(); onDelete(current); }} className="p-3 bg-red-600 hover:bg-red-700 rounded-full text-white">
          <Trash2 className="w-6 h-6" />
        </button>
      </div>
    </motion.div>
  );
}

export default function Dashboard() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [allMedia, setAllMedia] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteMediaDialogOpen, setDeleteMediaDialogOpen] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<Media | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "" });
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const handleDeleteMedia = async () => {
    if (!selectedMedia) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user');
      const { error } = await supabase.from('media').update({ deleted: true, deleted_at: new Date().toISOString(), deleted_by: user.id }).eq('id', selectedMedia.id);
      if (error) throw error;
      toast.success("Foto movida a la papelera");
      setDeleteMediaDialogOpen(false);
      setSelectedMedia(null);
      loadData();
    } catch (error) {
      console.error("Error deleting media:", error);
      toast.error("Error al eliminar la foto");
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const cachedMedia = getCachedMedia();
    if (cachedMedia.length > 0) {
      setAllMedia(cachedMedia);
      
      const cachedAlbumIds = [...new Set(cachedMedia.map(m => m.albumId).filter(Boolean))];
      
      if (cachedAlbumIds.length > 0) {
        const { data: albumsData } = await supabase.from('albums').select('*').eq('deleted', false).order('created_at', { ascending: true });
        if (albumsData) {
          const albumsWithCovers = albumsData.map(album => {
            const albumMedia = cachedMedia.filter(m => m.albumId === album.id);
            const firstMedia = albumMedia.length > 0 ? albumMedia[0] : null;
            return { id: album.id, name: album.name, description: album.description || '', coverUrl: firstMedia?.url || null, coverType: firstMedia?.type || null, createdAt: album.created_at, updatedAt: album.updated_at, createdBy: album.created_by, deleted: album.deleted };
          });
          setAlbums(albumsWithCovers);
        }
      }
    }
    
    try {
      const { data: albumsData, error: albumsError } = await supabase.from('albums').select('*').eq('deleted', false).order('created_at', { ascending: true });
      if (albumsError) throw albumsError;

      const { data: mediaData, error: mediaError } = await supabase.from('media').select('*').eq('deleted', false).order('created_at', { ascending: true });
      if (mediaError) throw mediaError;

      const newMedia: Media[] = [];
      for (const item of (mediaData || [])) {
        const cached = cachedMedia.find(m => m.id === item.id);
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

      setAllMedia(newMedia);
      setCachedMedia(newMedia);

      const albumsWithCovers = (albumsData || []).map(album => {
        const albumMedia = newMedia.filter(m => m.albumId === album.id);
        const firstMedia = albumMedia.length > 0 ? albumMedia[0] : null;
        return { id: album.id, name: album.name, description: album.description || '', coverUrl: firstMedia?.url || null, coverType: firstMedia?.type || null, createdAt: album.created_at, updatedAt: album.updated_at, createdBy: album.created_by, deleted: album.deleted };
      });

      setAlbums(albumsWithCovers);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user');

      const { error } = await supabase.from('albums').insert({
        name: formData.name,
        description: formData.description || null,
        created_by: user.id
      });

      if (error) throw error;

      toast.success("Álbum creado exitosamente");
      setCreateDialogOpen(false);
      setFormData({ name: "", description: "" });
      loadData();
    } catch (error) {
      console.error("Error creating album:", error);
      toast.error("Error al crear el álbum");
    } finally {
      setCreating(false);
    }
  };

  const handleEditAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAlbum) return;

    try {
      const { error } = await supabase
        .from('albums')
        .update({ name: formData.name, description: formData.description || null, updated_at: new Date().toISOString() })
        .eq('id', selectedAlbum.id);

      if (error) throw error;

      toast.success("Álbum actualizado exitosamente");
      setEditDialogOpen(false);
      setSelectedAlbum(null);
      setFormData({ name: "", description: "" });
      loadData();
    } catch (error) {
      console.error("Error updating album:", error);
      toast.error("Error al actualizar el álbum");
    }
  };

  const handleDeleteAlbum = async () => {
    if (!selectedAlbum) return;

    try {
      console.log("Deleting album:", selectedAlbum.id);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user');

      const { error } = await supabase
        .from('albums')
        .update({ deleted: true, deleted_at: new Date().toISOString(), deleted_by: user.id })
        .eq('id', selectedAlbum.id);

      console.log("Delete result:", error);
      if (error) throw error;

      toast.success("Álbum movido a la papelera");
      setDeleteDialogOpen(false);
      setSelectedAlbum(null);
      loadData();
    } catch (error) {
      console.error("Error deleting album:", error);
      toast.error("Error al eliminar el álbum: " + (error as Error).message);
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

  return (
    <div className="space-y-6">
      <AnimatePresence>
        {viewerOpen && (
          <FullscreenViewer media={allMedia} initialIndex={viewerIndex} onClose={() => setViewerOpen(false)} onDelete={(media) => { setSelectedMedia(media); setDeleteMediaDialogOpen(true); }} />
        )}
      </AnimatePresence>

      <Tabs defaultValue="albums" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="all" className="gap-2">
            <Grid className="w-4 h-4" />
            Todas las fotos
          </TabsTrigger>
          <TabsTrigger value="albums" className="gap-2">
            <Folder className="w-4 h-4" />
            Álbumes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-rose-600 to-pink-600 bg-clip-text text-transparent">
                Todas las fotos
              </h1>
              <p className="text-gray-600 mt-1">{allMedia.length} {allMedia.length === 1 ? "foto" : "fotos"}</p>
            </div>
          </div>

          {allMedia.length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center py-20">
              <ImageIcon className="w-20 h-20 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">No hay fotos todavía</h3>
              <p className="text-gray-500">Sube fotos desde los álbumes</p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {allMedia.map((item, index) => {
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
                      <div className="relative w-full h-full">
                        <video src={item.url} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                          <Play className="w-12 h-12 text-white drop-shadow-lg" />
                        </div>
                      </div>
                    ) : (
                      <img src={item.url} alt={item.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" />
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="albums" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-rose-600 to-pink-600 bg-clip-text text-transparent">Álbumes</h1>
              <p className="text-gray-600 mt-1">{albums.length} {albums.length === 1 ? "álbum" : "álbumes"}</p>
            </div>

            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 shadow-lg">
                  <Plus className="w-5 h-5" />Nuevo álbum
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Crear nuevo álbum</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreateAlbum} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nombre</Label>
                    <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Vacaciones 2024" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Descripción (opcional)</Label>
                    <Textarea id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Nuestro viaje a..." rows={3} />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)} disabled={creating}>Cancelar</Button>
                    <Button type="submit" disabled={creating}>{creating ? "Creando..." : "Crear álbum"}</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {albums.length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center py-20">
              <ImageIcon className="w-20 h-20 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">No hay álbumes todavía</h3>
              <p className="text-gray-500 mb-6">Crea tu primer álbum para empezar a guardar tus recuerdos</p>
              <Button onClick={() => setCreateDialogOpen(true)} className="gap-2 bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700">
                <Plus className="w-5 h-5" />Crear álbum
              </Button>
            </motion.div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {albums.map((album, index) => (
                <motion.div key={album.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                  <div className="group relative bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden border border-gray-100">
                    <Link to={`/album/${album.id}`}>
                      <div className="aspect-square bg-gradient-to-br from-rose-100 to-pink-100 flex items-center justify-center overflow-hidden relative">
                        {album.coverUrl ? (
                          album.coverType?.startsWith('video/') ? (
                            <video 
                              src={album.coverUrl} 
                              className="w-full h-full object-cover" 
                              muted 
                              loop 
                              playsInline
                              autoPlay
                            />
                          ) : (
                            <img src={album.coverUrl} alt={album.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" />
                          )
                        ) : (
                          <ImageIcon className="w-16 h-16 text-rose-300" />
                        )}
                      </div>
                    </Link>
                    <div className="absolute top-2 right-2 z-10">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-white/80 bg-white/60" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(menuOpen === album.id ? null : album.id); }}>
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                      {menuOpen === album.id && (
                        <div className="absolute right-0 mt-1 w-32 bg-white rounded-md shadow-lg border z-20">
                          <button onClick={() => { setMenuOpen(null); setSelectedAlbum(album); setFormData({ name: album.name, description: album.description }); setEditDialogOpen(true); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 flex items-center gap-2">
                            <Edit className="w-4 h-4" />Editar
                          </button>
                          <button onClick={() => { setMenuOpen(null); setSelectedAlbum(album); setDeleteDialogOpen(true); }} className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                            <Trash2 className="w-4 h-4" />Eliminar
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      <Link to={`/album/${album.id}`} className="flex-1 min-w-0 block">
                        <h3 className="font-semibold text-gray-900 truncate group-hover:text-rose-600 transition-colors">{album.name}</h3>
                        {album.description && <p className="text-sm text-gray-500 truncate mt-1">{album.description}</p>}
                      </Link>
                      <p className="text-xs text-gray-400 mt-2">
                        {new Date(album.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar álbum</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditAlbum} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Nombre</Label>
              <Input id="edit-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Descripción (opcional)</Label>
              <Textarea id="edit-description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={3} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>Cancelar</Button>
              <Button type="submit">Guardar cambios</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Mover álbum a la papelera?</AlertDialogTitle>
            <AlertDialogDescription>El álbum "{selectedAlbum?.name}" y todo su contenido se moverá a la papelera.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAlbum} className="bg-red-600 hover:bg-red-700">Mover a papelera</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteMediaDialogOpen} onOpenChange={setDeleteMediaDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Mover a la papelera?</AlertDialogTitle>
            <AlertDialogDescription>La foto "{selectedMedia?.name}" se moverá a la papelera.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteMedia} className="bg-red-600 hover:bg-red-700">Mover a papelera</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
