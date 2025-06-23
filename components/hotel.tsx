'use client';

import { useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { Loader2, Hotel, MapPin, Star, FileText, Settings } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

// Define the shape of the progress event content
interface HotelProgressContent {
  stage: 'preferences' | 'parsing' | 'searching' | 'details' | 'reviews' | 'formatting';
  message: string;
  current?: number;
  total?: number;
  destination?: string;
}

// Define the full event as streamed from the server
interface HotelProgressEvent {
  type: 'hotel-progress';
  content: HotelProgressContent;
}

// Map stages to icons and colors
const stageConfig = {
  preferences: { icon: Settings, color: 'text-primary' },
  parsing: { icon: FileText, color: 'text-primary' },
  searching: { icon: MapPin, color: 'text-primary' },
  details: { icon: Hotel, color: 'text-primary' },
  reviews: { icon: Star, color: 'text-primary' },
  formatting: { icon: Settings, color: 'text-primary' },
};

export function HotelProgress() {
  const { data } = useChat();
  
  // Set initial state
  const [currentProgress, setCurrentProgress] = useState<HotelProgressContent>({
    stage: 'preferences',
    message: 'Getting your hotel preferences...',
  });

  // Effect to process the data stream
  useEffect(() => {
    // Filter for hotel progress events
    const hotelProgressEvents = data?.filter(
      (item: any): item is HotelProgressEvent => item.type === 'hotel-progress'
    );

    // Get the latest event
    const latestEvent = hotelProgressEvents?.at(-1);
    if (latestEvent) {
      setCurrentProgress(latestEvent.content);
    }
  }, [data]); // Rerun when the data stream changes

  const config = stageConfig[currentProgress.stage];
  const IconComponent = config.icon;
  const progressPercentage =
    currentProgress.current && currentProgress.total
      ? (currentProgress.current / currentProgress.total) * 100
      : undefined;

  return (
    <Card className="w-full max-w-md mx-auto bg-card">
      <CardContent className="p-6">
        <div className="flex items-center space-x-4">
          <div className="p-3 rounded-full bg-accent">
            <IconComponent className={`size-6 ${config.color}`} />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-sm text-card-foreground">
              {currentProgress.message}
            </h3>
            {progressPercentage !== undefined && (
              <div className="mt-2">
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
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