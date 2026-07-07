const pulseClass = 'animate-pulse rounded-lg bg-slate-200/80';

const ThreadSkeleton = () => {
  return (
    <div className="space-y-6">
      <section className="forum-card-primary p-5">
        <div className={`${pulseClass} h-7 w-56`} />
        <div className={`${pulseClass} mt-2 h-4 w-80 max-w-full`} />
        <div className={`${pulseClass} mt-2 h-3 w-40`} />
      </section>

      <section className="space-y-3">
        <div className={`${pulseClass} h-28 w-full`} />
        <div className={`${pulseClass} h-28 w-full`} />
        <div className={`${pulseClass} h-28 w-full`} />
      </section>
    </div>
  );
};

export default ThreadSkeleton;
