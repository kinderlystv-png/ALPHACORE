export default function OfflinePage() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-semibold">Нет подключения</h1>
        <p className="text-zinc-500">Проверьте интернет и попробуйте снова.</p>
      </div>
    </div>
  );
}
