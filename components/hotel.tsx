'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useState } from 'react';
import { Loader2, Hotel, MapPin, Star, FileText, Settings } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface HotelProgressData {
  stage: 'preferences' | 'parsing' | 'searching' | 'details' | 'reviews' | 'formatting';
  message: string;
  current?: number;
  total?: number;
  destination?: string;
}

// Type guard to ensure we are only processing our custom hotel progress events
function isHotelProgressEvent(
  item: any
): item is { type: 'hotel-progress'; content: HotelProgressData } {
  return (
    item &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    item.type === 'hotel-progress' &&
    item.content &&
    typeof item.content === 'object'
  );
}

interface HotelProgressProps {
  chatId: string;
}

const stageConfig = {
  preferences: {
    icon: Settings,
    color: 'text-primary',
  },
  parsing: {
    icon: FileText,
    color: 'text-primary',
  },
  searching: {
    icon: MapPin,
    color: 'text-primary',
  },
  details: {
    icon: Hotel,
    color: 'text-primary',
  },
  reviews: {
    icon: Star,
    color: 'text-primary',
  },
  formatting: {
    icon: Settings,
    color: 'text-primary',
  },
};

export function HotelProgress({ chatId }: HotelProgressProps) {
  const { data } = useChat({ id: chatId });
  const [currentProgress, setCurrentProgress] = useState<HotelProgressData>({
    stage: 'preferences',
    message: 'Getting your hotel preferences...',
  });

  useEffect(() => {
    if (!data) return;

    const hotelProgressEvents = data.filter(isHotelProgressEvent);

    if (hotelProgressEvents.length > 0) {
      const latestEvent = hotelProgressEvents[hotelProgressEvents.length - 1];
      
      // This explicit check is the definitive fix for the build error.
      if (latestEvent) {
        setCurrentProgress(latestEvent.content);
      }
    }
  }, [data]);

  const config = stageConfig[currentProgress.stage];
  const IconComponent = config.icon;
  const progressPercentage = currentProgress.current && currentProgress.total 
    ? (currentProgress.current / currentProgress.total) * 100 
    : undefined;

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardContent className="p-6">
        <div className="flex items-center space-x-4">
          <div className={`p-3 rounded-full bg-accent`}>
            <IconComponent className={`size-6 ${config.color}`} />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-sm text-card-foreground">
              {currentProgress.message}
            </h3>
            {currentProgress.destination && (
              <p className="text-xs text-muted-foreground mt-1">
                Searching in {currentProgress.destination}
              </p>
            )}
            {progressPercentage !== undefined && (
              <div className="mt-2">
                <div className="w-full bg-muted rounded-full h-2">
                  <div 
                    className="bg-primary h-2 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {currentProgress.current} of {currentProgress.total} hotels
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              This may take 5-15 seconds...
            </p>
          </div>
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
} 