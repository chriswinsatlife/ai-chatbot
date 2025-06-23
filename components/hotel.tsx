'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Loader2,
  Hotel,
  MapPin,
  Star,
  FileText,
  Settings,
  type LucideProps,
} from 'lucide-react';

// --- Helper components from your example, adapted for our theme ---

function TextShimmer({ children, className }: { children: string; className?: string }) {
  return (
    <motion.span
      className={cn(
        'relative inline-block bg-clip-text text-transparent',
        'bg-[linear-gradient(90deg,var(--shimmer-color-from)_35%,var(--shimmer-color-via)_50%,var(--shimmer-color-from)_65%)]',
        'bg-[length:250%_100%]',
        className
      )}
      style={
        {
          '--shimmer-color-from': 'hsl(var(--muted-foreground))',
          '--shimmer-color-via': 'hsl(var(--foreground))',
        } as React.CSSProperties
      }
      animate={{ backgroundPosition: ['200% center', '-100% center'] }}
      transition={{
        duration: 2.5,
        ease: 'linear',
        repeat: Infinity,
      }}
    >
      {children}
    </motion.span>
  );
}

function PulsingDots() {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="flex space-x-1">
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          className="size-1.5 rounded-full bg-primary"
          animate={
            shouldReduceMotion
              ? {}
              : {
                  scale: [1, 1.2, 1],
                  opacity: [0.5, 1, 0.5],
                }
          }
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.2,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

// --- Our main component, now with the new design ---

// This is the data we receive from the `google-hotels.ts` tool
interface HotelProgressData {
  stage:
    | 'preferences'
    | 'parsing'
    | 'searching'
    | 'details'
    | 'reviews'
    | 'formatting';
  message: string;
  current?: number;
  total?: number;
  destination?: string;
}

// The props our component will accept
interface HotelProgressProps {
  progressData?: HotelProgressData;
}

// Define a type for the config object to make `rotating` property type-safe
type StageConfig = {
    [key in HotelProgressData['stage']]: {
        icon: React.ComponentType<{ className?: string }>;
        rotating?: boolean;
    }
}

const stageConfig: StageConfig = {
    preferences: { icon: Settings },
    parsing: { icon: FileText },
    searching: { icon: MapPin },
    details: { icon: Hotel },
    reviews: { icon: Star },
    formatting: { icon: Loader2, rotating: true },
};

export function HotelProgress({ progressData }: HotelProgressProps) {
  const [currentData, setCurrentData] = useState<HotelProgressData>({
    stage: 'preferences',
    message: 'Getting your hotel preferences...',
  });

  // Use an effect to smoothly update the data, preventing jarring changes
  useEffect(() => {
    if (progressData) {
      setCurrentData(progressData);
    }
  }, [progressData]);

  const { stage, message, current, total, destination } = currentData;
  const config = stageConfig[stage];
  const IconComponent = config.icon;

  const progressPercentage = current && total ? (current / total) * 100 : 0;
  
  // A "streaming" state is when we are looping through hotels
  const isStreaming = stage === 'details' || stage === 'reviews';

  return (
    <div
      className={cn(
        'relative w-full max-w-md overflow-hidden rounded-xl border p-4 backdrop-blur-sm',
        'border-primary/20 bg-primary/5'
      )}
    >
      <div className="relative flex items-center justify-between gap-3">
        {/* Left Side: Icon and Text */}
        <div className="flex flex-1 items-center gap-3 overflow-hidden">
          <motion.div
            key={stage}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className={cn('flex-shrink-0 text-primary', config.rotating && 'animate-spin')}
          >
            <IconComponent className="size-4" />
          </motion.div>

          <div className="flex-1 overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={message}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className="truncate text-sm font-medium text-foreground"
              >
                {isStreaming ? (
                  <TextShimmer>{message}</TextShimmer>
                ) : (
                  message
                )}
              </motion.div>
            </AnimatePresence>
            
            {(destination || (current && total)) && (
                <div className="mt-1.5 flex items-center gap-2">
                    {destination && <p className="text-xs text-muted-foreground">{destination}</p>}
                    {progressPercentage > 0 && (
                         <div className="h-1 w-16 overflow-hidden rounded-full bg-primary/10">
                            <motion.div
                            className="h-full rounded-full bg-primary"
                            initial={{ width: 0 }}
                            animate={{ width: `${progressPercentage}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                            />
                        </div>
                    )}
                </div>
            )}

          </div>
        </div>

        {/* Right Side: Live Indicator */}
        {isStreaming && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="hidden items-center gap-1.5 sm:flex"
          >
            <PulsingDots />
            <span className="text-xs font-mono text-muted-foreground">
              LIVE
            </span>
          </motion.div>
        )}
      </div>
    </div>
  );
} 