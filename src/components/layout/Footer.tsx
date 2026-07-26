import { useTranslation } from 'react-i18next';

const sourceUrl = `https://github.com/iffinland/Discssion-Boards/tree/v${__APP_VERSION__}`;

const Footer = () => {
  const { t } = useTranslation();
  return (
    <footer className="bg-forum-footer border-brand-primary border-t">
      <div className="text-ui-muted mx-auto max-w-6xl space-y-1 px-6 py-6 text-center text-sm">
        <p>{t('legal.summary', { version: __APP_VERSION__ })}</p>
        <p>
          {t('legal.noWarranty')}{' '}
          <a
            className="text-brand-accent-strong underline hover:no-underline"
            href={sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            {t('legal.source')}
          </a>
          {' · '}
          <a
            className="text-brand-accent-strong underline hover:no-underline"
            href="./LICENSE"
            rel="license"
            target="_blank"
          >
            {t('legal.license')}
          </a>
        </p>
      </div>
    </footer>
  );
};

export default Footer;
