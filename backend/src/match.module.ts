import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingRequest, CounselorProfile, AvailabilitySlot, Appointment } from './entities';
import { MatchService } from './match.service';

@Module({
  imports: [TypeOrmModule.forFeature([CounselorProfile, AvailabilitySlot, Appointment, BookingRequest])],
  providers: [MatchService],
  exports: [MatchService, TypeOrmModule],
})
export class MatchModule {}
