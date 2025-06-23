'use client';

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

interface HotelProgressProps {
  progressData?: HotelProgressData;
}

const stageConfig = {
  preferences: {
    icon: Settings,
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
  },
  parsing: {
    icon: FileText,
    color: 'text-purple-500',
    bgColor: 'bg-purple-50',
  },
  searching: {
    icon: MapPin,
    color: 'text-green-500',
    bgColor: 'bg-green-50',
  },
  details: {
    icon: Hotel,
    color: 'text-orange-500',
    bgColor: 'bg-orange-50',
  },
  reviews: {
    icon: Star,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-50',
  },
  formatting: {
    icon: Settings,
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-50',
  },
};

export function HotelProgress({ progressData }: HotelProgressProps) {
  const [currentProgress, setCurrentProgress] = useState<HotelProgressData>({
    stage: 'preferences',
    message: 'Getting your hotel preferences...',
  });

  useEffect(() => {
    if (progressData) {
      setCurrentProgress(progressData);
    }
  }, [progressData]);

  const config = stageConfig[currentProgress.stage];
  const IconComponent = config.icon;
  const progressPercentage = currentProgress.current && currentProgress.total 
    ? (currentProgress.current / currentProgress.total) * 100 
    : undefined;

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardContent className="p-6">
        <div className="flex items-center space-x-4">
          <div className={`p-3 rounded-full ${config.bgColor}`}>
            <IconComponent className={`h-6 w-6 ${config.color}`} />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-sm text-gray-900">
              {currentProgress.message}
            </h3>
            {currentProgress.destination && (
              <p className="text-xs text-gray-500 mt-1">
                Searching in {currentProgress.destination}
              </p>
            )}
            {progressPercentage !== undefined && (
              <div className="mt-2">
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {currentProgress.current} of {currentProgress.total} hotels
                </p>
              </div>
            )}
            <p className="text-xs text-gray-400 mt-2">
              This may take 5-15 seconds...
            </p>
          </div>
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
        </div>
      </CardContent>
    </Card>
  );
} 