'use client';

import { useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { Loader2, Search, FileText, Settings, History, Filter } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface GiftProgressContent {
  stage: 'context' | 'parsing' | 'searching' | 'formatting' | 'deduplication';
  message: string;
  current?: number;
  total?: number;
  website?: string;
}

const stageConfig = {
  context: { icon: History, color: 'text-primary' },
  parsing: { icon: FileText, color: 'text-primary' },
  searching: { icon: Search, color: 'text-primary' },
  formatting: { icon: Settings, color: 'text-primary' },
  deduplication: { icon: Filter, color: 'text-primary' },
};

interface GiftProgressProps {
  chatId: string;
}

export function GiftProgress({ chatId }: GiftProgressProps) {
  const { data } = useChat({ id: chatId });
  const [isClient, setIsClient] = useState(false);

  const [currentProgress, setCurrentProgress] = useState<GiftProgressContent>({
    stage: 'context',
    message: 'Getting gift history...',
  });

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!data || !isClient) return;
    let latest: GiftProgressContent | null = null;
    for (const item of data) {
      if (
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        (item as any).type === 'gift-progress' &&
        'content' in item &&
        typeof (item as any).content === 'object'
      ) {
        latest = (item as any).content as GiftProgressContent;
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

  if (!isClient) {
    return (
      <Card className="w-full max-w-md mx-auto bg-card">
        <CardContent className="p-6">
          <div className="flex items-center space-x-4">
            <div className="p-3 rounded-full bg-accent">
              <History className="size-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-sm text-card-foreground">
                Getting gift history...
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