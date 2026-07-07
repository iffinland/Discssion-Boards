import { toRichTextHtml } from '../src/services/forum/richText.js';

const expect = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = () => {
  const bold = toRichTextHtml('[b]Hello[/b]');
  expect(
    bold.includes('<strong>Hello</strong>'),
    'Bold tag should render <strong>.'
  );

  const escaped = toRichTextHtml('<script>alert("xss")</script>');
  expect(
    escaped.includes('&lt;script&gt;'),
    'Raw script tags must be escaped into plain text.'
  );

  const unsafeImage = toRichTextHtml('[img]javascript:alert(1)[/img]');
  expect(
    !unsafeImage.includes('<img'),
    'Unsafe image source must not render image.'
  );

  const safeImage = toRichTextHtml('[img]https://example.com/a.png[/img]');
  expect(
    safeImage.includes('data-preview-image="true"'),
    'Safe image should render preview metadata.'
  );

  const qdnImage = toRichTextHtml('[imgqdn]Forum|image-id[/imgqdn]');
  expect(
    qdnImage.includes('data-qdn-image-placeholder="true"'),
    'QDN image tag should render a lazy placeholder.'
  );
  expect(
    !qdnImage.includes('<img'),
    'QDN image tag must not render an image before viewport resolution.'
  );

  const color = toRichTextHtml('[color=#2563EB]Blue[/color]');
  expect(
    color.includes('style="color:#2563EB"'),
    'Color tag should render safe inline color.'
  );

  const videoHtml = toRichTextHtml(
    '[videoqdn]qdn|Qortal-Video-Bridge|qvb-example|Bridge%20video[/videoqdn]'
  );
  expect(
    videoHtml.includes('data-video-embed="true"'),
    'Video tag should render lightweight placeholder.'
  );
  expect(
    !videoHtml.includes('<video'),
    'Video tag must not render a video element during post rendering.'
  );
};

run();
console.log('Rich text sanitizer checks passed.');
