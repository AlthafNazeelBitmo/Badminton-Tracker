import { Module } from '@nestjs/common';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { MatchRecordLoader } from './match-record.loader';
import { PlayersModule } from '../players/players.module';
import { VenuesModule } from '../venues/venues.module';
import { RatingService } from '../analytics/rating.service';
import { AchievementsService } from '../progress/achievements.service';

/**
 * `MatchRecordLoader` is exported because every analytics surface reads through it.
 * Keeping one loader means one place where filter semantics and the query shape live.
 */
@Module({
  imports: [PlayersModule, VenuesModule],
  controllers: [MatchesController],
  providers: [MatchesService, MatchRecordLoader, RatingService, AchievementsService],
  exports: [MatchesService, MatchRecordLoader, RatingService, AchievementsService],
})
export class MatchesModule {}
