export interface Album {
  id: string;
  name: string;
  description: string;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deleted: boolean;
  deletedAt?: string;
  deletedBy?: string;
}

export interface Media {
  id: string;
  albumId: string;
  path: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
  createdBy: string;
  deleted: boolean;
  deletedAt?: string;
  deletedBy?: string;
  url: string;
}
