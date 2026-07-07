const pulseClass = 'animate-pulse rounded-lg bg-slate-200/80';

const HomeSkeleton = () => {
  return (
    <div className="space-y-6">
      <section className="forum-card-accent p-5">
        <div className={`${pulseClass} h-5 w-40`} />
        <div className="mt-3 space-y-2">
          <div className={`${pulseClass} h-12 w-full`} />
          <div className={`${pulseClass} h-12 w-full`} />
          <div className={`${pulseClass} h-12 w-full`} />
        </div>
      </section>

      <section className="space-y-3">
        <div className={`${pulseClass} h-6 w-36`} />
        <div className={`${pulseClass} h-4 w-80 max-w-full`} />
      </section>

      <div className="space-y-4">
        <div className={`${pulseClass} h-20 w-full`} />
        <div className={`${pulseClass} h-20 w-full`} />
        <div className={`${pulseClass} h-20 w-full`} />
      </div>
    </div>
  );
};

export default HomeSkeleton;
