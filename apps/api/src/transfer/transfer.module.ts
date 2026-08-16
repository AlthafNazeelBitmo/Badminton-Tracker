import { Module } from '@nestjs/common';
import { TransferController } from './transfer.controller';
import { ImportService } from './import.service';
import { ExportService } from './export.service';
import { MatchesModule } from '../matches/matches.module';
import { PlayersModule } from '../players/players.module';
import { VenuesModule } from '../venues/venues.module';

@Module({
  imports: [MatchesModule, PlayersModule, VenuesModule],
  controllers: [TransferController],
  providers: [ImportService, ExportService],
  exports: [ImportService, ExportService],
})
export class TransferModule {}
