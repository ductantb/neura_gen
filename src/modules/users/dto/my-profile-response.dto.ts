import { JobStatus, JobType, UserRole } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class UserCreditDto {
  @ApiProperty({
    description: 'Số dư credit hiện tại của người dùng',
    example: 120,
  })
  balance: number;

  @ApiProperty({
    description: 'Thời điểm số dư được cập nhật gần nhất',
    example: '2026-03-29T08:30:00.000Z',
  })
  updatedAt: Date;
}

class UserProfileCountsDto {
  @ApiProperty({
    description: 'Số người đang theo dõi tài khoản này',
    example: 12,
  })
  followers: number;

  @ApiProperty({
    description: 'Số tài khoản mà người dùng đang theo dõi',
    example: 8,
  })
  following: number;

  @ApiProperty({
    description: 'Số bài post đã tạo',
    example: 5,
  })
  posts: number;

  @ApiProperty({
    description: 'Số job đã tạo',
    example: 14,
  })
  jobs: number;
}

class UserProfileJobDto {
  @ApiProperty({
    description: 'ID của job',
    example: '6de4e89d-fd9a-4d77-8f5f-2d1af9f95c6f',
  })
  id: string;

  @ApiProperty({
    description: 'Loại job',
    enum: JobType,
    example: JobType.IMAGE_TO_VIDEO,
  })
  type: JobType;

  @ApiProperty({
    description: 'Trạng thái hiện tại của job',
    enum: JobStatus,
    example: JobStatus.PROCESSING,
  })
  status: JobStatus;

  @ApiProperty({
    description: 'Tiến độ xử lý job, từ 0 đến 100',
    example: 65,
  })
  progress: number;

  @ApiProperty({
    description: 'Prompt dùng để tạo job',
    example: 'A cinematic drone shot over a futuristic city at sunset',
  })
  prompt: string;

  @ApiPropertyOptional({
    description: 'Negative prompt của job',
    example: 'blur, low quality, artifacts',
    nullable: true,
  })
  negativePrompt?: string | null;

  @ApiProperty({
    description: 'Tên model dùng để chạy job',
    example: 'veo-2-fast',
  })
  modelName: string;

  @ApiProperty({
    description: 'Cho biết job có bật chế độ turbo hay không',
    example: true,
  })
  turboEnabled: boolean;

  @ApiProperty({
    description: 'Số credit đã trừ cho job này',
    example: 10,
  })
  creditCost: number;

  @ApiPropertyOptional({
    description: 'Tên provider xử lý job',
    example: 'google',
    nullable: true,
  })
  provider?: string | null;

  @ApiPropertyOptional({
    description: 'Thông báo lỗi nếu job thất bại',
    example: 'Queue enqueue failed',
    nullable: true,
  })
  errorMessage?: string | null;

  @ApiProperty({
    description: 'Thời điểm tạo job',
    example: '2026-03-29T08:30:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Thời điểm cập nhật job gần nhất',
    example: '2026-03-29T08:35:00.000Z',
  })
  updatedAt: Date;

  @ApiPropertyOptional({
    description: 'Thời điểm bắt đầu xử lý',
    example: '2026-03-29T08:31:00.000Z',
    nullable: true,
  })
  startedAt?: Date | null;

  @ApiPropertyOptional({
    description: 'Thời điểm hoàn thành job',
    example: '2026-03-29T08:36:00.000Z',
    nullable: true,
  })
  completedAt?: Date | null;

  @ApiPropertyOptional({
    description: 'Thời điểm job thất bại hoặc bị hủy',
    example: '2026-03-29T08:34:00.000Z',
    nullable: true,
  })
  failedAt?: Date | null;
}

class PaginatedUserProfileJobsDto {
  @ApiProperty({
    description: 'Danh sách job của người dùng theo trang hiện tại',
    type: [UserProfileJobDto],
  })
  data: UserProfileJobDto[];

  @ApiPropertyOptional({
    description: 'Cursor cho trang kế tiếp, null nếu đã hết dữ liệu',
    example: '6de4e89d-fd9a-4d77-8f5f-2d1af9f95c6f',
    nullable: true,
  })
  nextCursor?: string | null;

  @ApiProperty({
    description: 'Số lượng bản ghi yêu cầu trên mỗi lần lấy',
    example: 10,
  })
  take: number;
}

export class MyProfileResponseDto {
  @ApiProperty({
    description: 'ID của người dùng',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Email của người dùng',
    example: 'test@example.com',
  })
  email: string;

  @ApiProperty({
    description: 'Tên hiển thị hoặc username',
    example: 'neura_gen_2026',
  })
  username: string;

  @ApiPropertyOptional({
    description: 'Đường dẫn ảnh đại diện',
    example: 'https://cdn.example.com/avatars/user-1.jpg',
    nullable: true,
  })
  avatarUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Tiểu sử ngắn của người dùng',
    example: 'Đam mê công nghệ AI và thiết kế chuyển động.',
    nullable: true,
  })
  bio?: string | null;

  @ApiProperty({
    description: 'Vai trò của người dùng trong hệ thống',
    enum: UserRole,
    example: UserRole.FREE,
  })
  role: UserRole;

  @ApiPropertyOptional({
    description: 'Thời điểm hết hạn PRO, null nếu chưa nâng cấp PRO',
    example: '2026-05-10T10:00:00.000Z',
    nullable: true,
  })
  proExpiresAt?: Date | null;

  @ApiProperty({
    description: 'Thời điểm tạo tài khoản',
    example: '2026-03-20T10:00:00.000Z',
  })
  createdAt: Date;

  @ApiPropertyOptional({
    description: 'Thông tin ví credit của người dùng',
    type: UserCreditDto,
    nullable: true,
  })
  credits?: UserCreditDto | null;

  @ApiProperty({
    description: 'Các thống kê nhanh của tài khoản',
    type: UserProfileCountsDto,
  })
  counts: UserProfileCountsDto;

  @ApiProperty({
    description: 'Danh sách job mà người dùng đã tạo theo cơ chế phân trang cursor',
    type: PaginatedUserProfileJobsDto,
  })
  jobs: PaginatedUserProfileJobsDto;
}
