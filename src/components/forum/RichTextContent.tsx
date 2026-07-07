import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';

import {
  extractQdnImageTags,
  toRichTextHtml,
} from '../../services/forum/richText';
import {
  parseQdnVideoTagPayload,
  type ForumVideoReference,
} from '../../services/forum/videoEmbed';
import { forumQdnService } from '../../services/qdn/forumQdnService';
import { perfDebugLog } from '../../services/perf/perfDebug';
import { highlightHtmlText } from '../../services/forum/searchHighlight';
import ImagePreviewModal from './ImagePreviewModal';
import VideoPreviewModal from './VideoPreviewModal';

type RichTextContentProps = {
  value: string;
  className?: string;
  highlightQuery?: string;
};

type ImageReference = {
  service: string;
  name: string;
  identifier: string;
  filename?: string;
};

const imageUrlCache = new Map<string, string | null>();
const imageUrlInflight = new Map<string, Promise<string | null>>();

const toImageReferenceKey = (reference: ImageReference) =>
  [
    reference.service,
    reference.name,
    reference.identifier,
    reference.filename ?? '',
  ].join(':');

const resolveImageUrlCached = async (reference: ImageReference) => {
  const cacheKey = toImageReferenceKey(reference);
  if (imageUrlCache.has(cacheKey)) {
    return imageUrlCache.get(cacheKey) ?? null;
  }

  const existingInflight = imageUrlInflight.get(cacheKey);
  if (existingInflight) {
    return existingInflight;
  }

  const requestPromise = forumQdnService
    .getPostImageResourceUrl(reference)
    .then((url) => {
      imageUrlCache.set(cacheKey, url);
      return url;
    })
    .catch(() => {
      imageUrlCache.set(cacheKey, null);
      return null;
    })
    .finally(() => {
      imageUrlInflight.delete(cacheKey);
    });

  imageUrlInflight.set(cacheKey, requestPromise);
  return requestPromise;
};

const RichTextContent = ({
  value,
  className,
  highlightQuery = '',
}: RichTextContentProps) => {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const resolvingImagePayloadsRef = useRef<Set<string>>(new Set());
  const [resolvedImageUrlsByPayload, setResolvedImageUrlsByPayload] = useState<
    Record<string, string | null>
  >({});
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [previewVideoReference, setPreviewVideoReference] =
    useState<ForumVideoReference | null>(null);
  const imageTags = useMemo(() => extractQdnImageTags(value), [value]);
  const imageTagsByPayload = useMemo(
    () => new Map(imageTags.map((tag) => [tag.payload, tag])),
    [imageTags]
  );

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      if (target.dataset.previewImage !== 'true') {
        return;
      }

      const source = target.dataset.fullSrc ?? target.getAttribute('src');
      if (!source) {
        return;
      }

      setPreviewImageSrc(source);
      return;
    }

    if (!(target instanceof Element)) {
      return;
    }

    const videoButton = target.closest<HTMLButtonElement>(
      '[data-video-embed="true"]'
    );
    const payload = videoButton?.dataset.videoPayload;
    if (!payload) {
      return;
    }

    const reference = parseQdnVideoTagPayload(payload);
    if (reference) {
      setPreviewVideoReference(reference);
    }
  };

  useEffect(() => {
    resolvingImagePayloadsRef.current.clear();
    setResolvedImageUrlsByPayload({});
  }, [value]);

  const resolvedValue = useMemo(() => {
    if (imageTags.length === 0) {
      return value;
    }

    return imageTags.reduce((nextValue, tag) => {
      const resolvedUrl = resolvedImageUrlsByPayload[tag.payload];
      const replacement =
        resolvedUrl === undefined
          ? `[imgqdnplaceholder]${tag.payload}[/imgqdnplaceholder]`
          : resolvedUrl
            ? `[img]${resolvedUrl}[/img]`
            : `[imgqdnmissing]${tag.payload}[/imgqdnmissing]`;

      return nextValue.split(tag.rawTag).join(replacement);
    }, value);
  }, [imageTags, resolvedImageUrlsByPayload, value]);

  const html = useMemo(
    () => highlightHtmlText(toRichTextHtml(resolvedValue), highlightQuery),
    [highlightQuery, resolvedValue]
  );

  const resolveImagePayload = useCallback(
    async (payload: string, reference: ImageReference) => {
      if (
        resolvingImagePayloadsRef.current.has(payload) ||
        Object.prototype.hasOwnProperty.call(
          resolvedImageUrlsByPayload,
          payload
        )
      ) {
        return;
      }

      resolvingImagePayloadsRef.current.add(payload);
      const startedAt = performance.now();
      const cacheHit = imageUrlCache.has(toImageReferenceKey(reference));
      const resourceUrl = await resolveImageUrlCached(reference);
      const elapsedMs = performance.now() - startedAt;

      setResolvedImageUrlsByPayload((current) => ({
        ...current,
        [payload]: resourceUrl,
      }));
      resolvingImagePayloadsRef.current.delete(payload);

      perfDebugLog('richtext-image-resolve', {
        cacheHit,
        resolved: Boolean(resourceUrl),
        elapsedMs: Number(elapsedMs.toFixed(1)),
      });
    },
    [resolvedImageUrlsByPayload]
  );

  useEffect(() => {
    const root = contentRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const imagePlaceholders = Array.from(
      root.querySelectorAll<HTMLElement>('[data-qdn-image-placeholder="true"]')
    );
    if (imagePlaceholders.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          const element = entry.target as HTMLElement;
          const payload = element.dataset.qdnImagePayload;
          const tag = payload ? imageTagsByPayload.get(payload) : null;
          if (payload && tag) {
            void resolveImagePayload(payload, tag.reference);
          }
          observer.unobserve(element);
        });
      },
      { rootMargin: '180px 0px' }
    );

    imagePlaceholders.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
    };
  }, [html, imageTagsByPayload, resolveImagePayload]);

  useEffect(() => {
    const root = contentRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const videoEmbeds = Array.from(
      root.querySelectorAll<HTMLElement>('[data-video-embed="true"]')
    );
    if (videoEmbeds.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }
          const element = entry.target as HTMLElement;
          element.dataset.videoVisible = 'true';
          observer.unobserve(element);
        });
      },
      { rootMargin: '120px 0px' }
    );

    videoEmbeds.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
    };
  }, [html]);

  return (
    <>
      <div
        ref={contentRef}
        className={className}
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <ImagePreviewModal
        isOpen={previewImageSrc !== null}
        imageSrc={previewImageSrc}
        onClose={() => setPreviewImageSrc(null)}
      />
      <VideoPreviewModal
        isOpen={previewVideoReference !== null}
        reference={previewVideoReference}
        onClose={() => setPreviewVideoReference(null)}
      />
    </>
  );
};

export default RichTextContent;
