export interface NearProfileImage {
  url?: string;
  ipfs_cid?: string;
}

export function resolveNearImageUrl(image?: NearProfileImage | null): string | undefined {
  if (image?.url) return image.url;
  if (image?.ipfs_cid) return `https://ipfs.near.social/ipfs/${image.ipfs_cid}`;
  return undefined;
}

export function getNearInitials(name?: string | null): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}
