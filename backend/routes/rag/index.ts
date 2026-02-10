import { Router } from 'express';
import ingestRouter from './ingest';
import retrieveRouter from './retrieve';
import profileRouter from './profile';

const router = Router();

router.use('/ingest', ingestRouter);
router.use('/retrieve', retrieveRouter);
router.use('/profile', profileRouter);

export default router;