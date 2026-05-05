import { Module }               from '@nestjs/common';
import { FixedAssetsController } from './fixed-assets.controller';
import { FixedAssetsService }    from './fixed-assets.service';

@Module({
  controllers: [FixedAssetsController],
  providers:   [FixedAssetsService],
  exports:     [FixedAssetsService],
})
export class FixedAssetsModule {}
