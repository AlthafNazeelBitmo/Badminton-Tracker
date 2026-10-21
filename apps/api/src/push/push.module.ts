import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { ExpoPushTransport, PUSH_TRANSPORT } from './push-transport';
import { PushService } from './push.service';

@Module({
  imports: [DevicesModule],
  providers: [PushService, { provide: PUSH_TRANSPORT, useClass: ExpoPushTransport }],
  exports: [PushService],
})
export class PushModule {}
