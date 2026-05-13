import { Module } from '@nestjs/common';
import { firebaseAdminProvider } from './firebase-admin.provider';
import { PushService } from './push.service';

@Module({
  providers: [firebaseAdminProvider, PushService],
  exports: [PushService],
})
export class PushModule {}
