'use client';

import { useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { Loader2, Plane, MapPin, CreditCard, FileText, Settings } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

// Define the shape of the progress event content
interface FlightProgressContent {
  stage: 'preferences' | 'parsing' | 'searching' | 'booking' | 'formatting';
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
  booking: { icon: CreditCard, color: 'text-primary' },
  formatting: { icon: Settings, color: 'text-primary' },
};

interface FlightProgressProps {
  chatId: string;
}

export function FlightProgress({ chatId }: FlightProgressProps) {
  const { data } = useChat({ id: chatId });
  const [isClient, setIsClient] = useState(false);

  const [currentProgress, setCurrentProgress] = useState<FlightProgressContent>({
    stage: 'preferences',
    message: 'Getting your flight preferences...',
  });

  // Handle hydration
  useEffect(() => {
    setIsClient(true);
  }, []);

  // This robustly parses the data stream to find the latest progress event.
  useEffect(() => {
    if (!data || !isClient) return;
    // Find the last valid 'flight-progress' event in the stream.
    let latest: FlightProgressContent | null = null;
    for (const item of data) {
      if (
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        (item as any).type === 'flight-progress' &&
        'content' in item &&
        typeof (item as any).content === 'object'
      ) {
        latest = (item as any).content as FlightProgressContent;
      }
    }
    if (latest) setCurrentProgress(latest);
  }, [data, isClient]);

  const config = stageConfig[currentProgress.stage];
  const IconComponent = config.icon;
  const progressPercentage =
    currentProgress.current && currentProgress.total
      ? (currentProgress.current / currentProgress.total) * 100
      : undefined;

  // Don't render anything until client-side hydration is complete
  if (!isClient) {
    return (
      <Card className="w-full max-w-md mx-auto bg-card">
        <CardContent className="p-6">
          <div className="flex items-center space-x-4">
            <div className="p-3 rounded-full bg-accent">
              <Settings className="size-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-sm text-card-foreground">
                Getting your flight preferences...
              </h3>
              <p className="text-xs text-muted-foreground mt-2">
                Please wait while I work on your request...
              </p>
            </div>
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

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
              Please wait while I work on your request...
            </p>
          </div>
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
} 