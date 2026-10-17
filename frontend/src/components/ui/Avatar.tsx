import { useState } from 'react';
import Image from 'next/image';
import { UserIcon } from '@heroicons/react/24/solid';
import { cn } from '@/utils/cn';

interface AvatarProps {
  src?: string;
  alt: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  name?: string;
  className?: string;
}

export function Avatar({ src, alt, size = 'md', name, className }: AvatarProps) {
  const [imageError, setImageError] = useState(false);
  
  const sizeClasses = {
    sm: 'w-6 h-6 text-xs',
    md: 'w-8 h-8 text-sm', 
    lg: 'w-12 h-12 text-base',
    xl: 'w-16 h-16 text-lg',
  };
  
  const iconSizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-6 h-6', 
    xl: 'w-8 h-8',
  };

  // Generate initials from name
  const getInitials = (name?: string) => {
    if (!name) return '?';
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Generate color based on name for consistent avatar colors
  const getBackgroundColor = (name?: string) => {
    if (!name) return 'bg-gray-500';
    
    const colors = [
      'bg-blue-500',
      'bg-green-500', 
      'bg-yellow-500',
      'bg-purple-500',
      'bg-pink-500',
      'bg-indigo-500',
      'bg-red-500',
      'bg-orange-500',
    ];
    
    const charCodeSum = name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return colors[charCodeSum % colors.length];
  };

  const baseClasses = cn(
    'inline-flex items-center justify-center rounded-full overflow-hidden',
    sizeClasses[size],
    className
  );

  if (src && !imageError) {
    return (
      <Image
        src={src}
        alt={alt}
        className={baseClasses}
        width={64}
        height={64}
        sizes="(max-width: 640px) 24px, (max-width: 768px) 32px, 64px"
        onError={() => setImageError(true)}
      />
    );
  }

  // Fallback to initials or icon
  if (name) {
    return (
      <div className={cn(baseClasses, getBackgroundColor(name), 'text-white font-medium')}>
        {getInitials(name)}
      </div>
    );
  }

  // Final fallback to icon
  return (
    <div className={cn(baseClasses, 'bg-gray-300 text-gray-600')}>
      <UserIcon className={iconSizeClasses[size]} />
    </div>
  );
}