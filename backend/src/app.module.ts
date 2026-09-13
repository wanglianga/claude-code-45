import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  User, CounselorProfile, AvailabilitySlot, BookingRequest, Appointment, Screening,
  ConsultationRecord, Referral, CrisisEvent, FollowUp, ServiceRating,
  FamilyAccessRequest, LeaveRequest, ServiceChainEvent, HighRiskTriage,
} from './entities';
import { AuthModule } from './auth.module';
import { ResidentModule } from './resident.module';
import { WorkerModule } from './worker.module';
import { CounselorModule } from './counselor.module';
import { AdminModule } from './admin.module';
import { DefaultNamingStrategy } from 'typeorm';
import { SeedService } from './seed.service';
import { HealthController } from './health.controller';

// 统一 snake_case 列名，保证 @Column residentId 与 @JoinColumn resident_id 对齐
class SnakeNamingStrategy extends DefaultNamingStrategy {
  columnName(propertyName: string, customName: string): string {
    return customName || propertyName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'db',
      port: Number(process.env.DB_PORT || 5432),
      username: process.env.DB_USER || 'psycare',
      password: process.env.DB_PASSWORD || 'psycare',
      database: process.env.DB_NAME || 'psycare',
      entities: [
        User, CounselorProfile, AvailabilitySlot, BookingRequest, Appointment, Screening,
        ConsultationRecord, Referral, CrisisEvent, FollowUp, ServiceRating,
        FamilyAccessRequest, LeaveRequest, ServiceChainEvent, HighRiskTriage,
      ],
      synchronize: true,
      namingStrategy: new SnakeNamingStrategy(),
      retryAttempts: 20,
      retryDelay: 3000,
    }),
    TypeOrmModule.forFeature([
      User, CounselorProfile, AvailabilitySlot, BookingRequest, Appointment,
      Screening, ConsultationRecord, Referral, CrisisEvent, FollowUp,
      ServiceRating, FamilyAccessRequest, LeaveRequest, ServiceChainEvent, HighRiskTriage,
    ]),
    AuthModule, ResidentModule, WorkerModule, CounselorModule, AdminModule,
  ],
  controllers: [HealthController],
  providers: [SeedService],
})
export class AppModule {}
