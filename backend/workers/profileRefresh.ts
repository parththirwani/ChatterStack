import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { inferUserProfile } from '../services/profile/profiler';

/**
 * Daily profile refresh for active users
 */
export function startProfileRefreshWorker() {
  // Run daily at 2 AM (configurable via env)
  const schedule = process.env.PROFILE_REFRESH_CRON || '0 2 * * *';
  
  cron.schedule(schedule, async () => {
    console.log('=== Starting Profile Refresh Worker ===');
    
    try {
      // Get users with recent activity (last 7 days)
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 7);
      
      const activeUsers = await prisma.user.findMany({
        where: {
          conversations: {
            some: {
              updatedAt: {
                gte: recentDate,
              },
            },
          },
        },
        select: { id: true },
      });
      
      console.log(`Found ${activeUsers.length} active users`);
      
      // Refresh profiles in batches
      const BATCH_SIZE = 10;
      for (let i = 0; i < activeUsers.length; i += BATCH_SIZE) {
        const batch = activeUsers.slice(i, i + BATCH_SIZE);
        
        await Promise.all(
          batch.map(user => 
            inferUserProfile(user.id).catch(err => {
              console.error(`Failed to refresh profile for ${user.id}:`, err);
            })
          )
        );
        
        console.log(`Refreshed profiles: ${i + batch.length}/${activeUsers.length}`);
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log('✓ Profile refresh completed');
    } catch (error) {
      console.error('Profile refresh worker error:', error);
    }
  });
  
  console.log(`✓ Profile refresh worker started (schedule: ${schedule})`);
}