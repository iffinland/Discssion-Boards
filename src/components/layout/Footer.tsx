import { useTranslation } from 'react-i18next';

const Footer = () => {
  const { t } = useTranslation();
  return (
    <footer className="bg-forum-footer border-brand-primary border-t">
      <div className="text-ui-muted mx-auto max-w-6xl px-6 py-6 text-center text-sm">
        {t('app.version')}
      </div>
    </footer>
  );
};

export default Footer;
