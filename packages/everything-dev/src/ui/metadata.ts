const SOCIAL_IMAGE_WIDTH = 1200;
const SOCIAL_IMAGE_HEIGHT = 630;

interface SocialImageMetaOptions {
  imageUrl: string;
  title: string;
  description: string;
  siteName?: string;
  siteUrl?: string;
  type?: string;
  alt?: string;
  width?: number;
  height?: number;
  mimeType?: string;
}

export function getSocialImageMeta(options: SocialImageMetaOptions) {
  const {
    imageUrl,
    title,
    description,
    siteName,
    siteUrl,
    type = "website",
    alt,
    width = SOCIAL_IMAGE_WIDTH,
    height = SOCIAL_IMAGE_HEIGHT,
    mimeType = "image/png",
  } = options;

  return [
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: type },
    { property: "og:image", content: imageUrl },
    { property: "og:image:type", content: mimeType },
    { property: "og:image:width", content: String(width) },
    { property: "og:image:height", content: String(height) },
    ...(alt ? [{ property: "og:image:alt", content: alt }] : []),
    ...(siteName ? [{ property: "og:site_name", content: siteName }] : []),
    ...(siteUrl ? [{ property: "og:url", content: siteUrl }] : []),
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: imageUrl },
    ...(alt ? [{ name: "twitter:image:alt", content: alt }] : []),
  ];
}
