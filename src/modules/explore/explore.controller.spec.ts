import { ExploreController } from './explore.controller';

describe('ExploreController', () => {
  const exploreService = {
    getExplore: jest.fn(),
    searchByTopic: jest.fn(),
  };

  let controller: ExploreController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ExploreController(exploreService as any);
  });

  it('routes the topic search endpoint to searchByTopic and returns explore items', async () => {
    const payload = {
      mode: 'top',
      data: [{ id: 'item-1', topic: 'anime' }],
      nextCursor: null,
      limit: 20,
    };
    exploreService.searchByTopic.mockResolvedValue(payload);

    await expect(
      controller.searchByTopic({
        topic: 'anime',
        limit: 20,
      }),
    ).resolves.toEqual(payload);

    expect(exploreService.searchByTopic).toHaveBeenCalledWith({
      topic: 'anime',
      limit: 20,
    });
  });
});
