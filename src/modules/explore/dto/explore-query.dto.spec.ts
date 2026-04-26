import { validateSync } from 'class-validator';
import { ExploreQueryDto } from './explore-query.dto';

describe('ExploreQueryDto', () => {
  it('rejects mode=for_you on the public explore endpoint contract', () => {
    const dto = Object.assign(new ExploreQueryDto(), {
      mode: 'for_you' as any,
    });

    const errors = validateSync(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isIn).toBeDefined();
  });
});
