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

  const [currentProgress, setCurrentProgress] = useState<HotelProgressContent>({
    stage: 'preferences',
    message: 'Getting your hotel preferences...',
  });

  // This robustly parses the data stream to find the latest progress event.
  useEffect(() => {
    if (!data) return;

    // Find the last valid 'hotel-progress' event in the stream.
    const latestProgressContent = data.reduce((acc, item) => {
      if (
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        (item as any).type === 'hotel-progress' &&
        'content' in item &&
        typeof (item as any).content === 'object'
      ) {
        return (item as any).content as HotelProgressContent;
      }
      return acc;
    }, null as HotelProgressContent | null);

    if (latestProgressContent) {
      setCurrentProgress(latestProgressContent);
    }
  }, [data]);

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