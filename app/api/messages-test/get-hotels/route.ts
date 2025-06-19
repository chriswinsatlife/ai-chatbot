import { NextResponse } from 'next/server';
import { getHotels } from '@/lib/ai/tools/get-hotels';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get('city') || '';
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  if (!city) {
    return NextResponse.json({ error: 'Missing "city" query parameter' }, { status: 400 });
  }

  try {
    const result = await (getHotels as any).execute({ location: city, limit });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[messages-test/get-hotels] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}