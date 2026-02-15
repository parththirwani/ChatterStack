import Link from 'next/link';
import Image from 'next/image';
import { MessageInput } from '../input/MessageInput';

export const EmptyState = () => {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-2xl">
        <Link href="/">
          <Image src="/logo.png" alt="Logo" width={120} height={120} />
        </Link>
        <h1>Welcome to <span className="text-yellow-500">ChatterStack</span></h1>
        <MessageInput />
      </div>
    </div>
  );
};