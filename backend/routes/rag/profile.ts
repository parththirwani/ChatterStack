import { Router } from 'express';
import { authenticate } from '../../middleware/authentication';
import { getUserProfile, saveUserProfile } from '../../services/profile/storage';
import { inferUserProfile } from '../../services/profile/profiler';

const router = Router();

/**
 * GET /api/rag/profile/:userId
 * Get user profile
 */
router.get('/:userId', authenticate, async (req, res) => {
  try {
    const requestingUserId = (req as any).user.id;
    const targetUserId = req.params.userId;

    if (!targetUserId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    // Users can only access their own profile
    if (requestingUserId !== targetUserId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    const profile = await getUserProfile(targetUserId as string);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    res.json({ profile });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/rag/profile/refresh
 * Trigger profile inference
 */
router.post('/refresh', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    
    // Trigger async profile inference
    inferUserProfile(userId)
      .catch(err => console.error('Background profile inference failed:', err));
    
    res.json({ success: true, message: 'Profile refresh initiated' });
  } catch (error) {
    console.error('Profile refresh error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/rag/profile/:userId
 * Manually update profile preferences
 */
router.put('/:userId', authenticate, async (req, res) => {
  try {
    const requestingUserId = (req as any).user.id;
    const targetUserId = req.params.userId;
    
    if (!targetUserId || requestingUserId !== targetUserId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    const { explanationStyle, technicalLevel, preferences } = req.body;
    
    let profile = await getUserProfile(targetUserId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    // Update allowed fields
    if (explanationStyle) profile.explanationStyle = explanationStyle;
    if (technicalLevel) profile.technicalLevel = technicalLevel;
    if (preferences) profile.preferences = { ...profile.preferences, ...preferences };
    
    profile.lastUpdated = new Date();
    
    await saveUserProfile(profile);
    
    res.json({ success: true, profile });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;