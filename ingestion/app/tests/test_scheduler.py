from ..services import scheduler

def test_two_solutions(db_session):
    schedules = scheduler.generate(
        db_session,
        course_codes=["CSCI201", "EE109"],
        term="20253",
        max_results=10,
        ranking_weights={},
    )
    # With the fixture above we expect exactly 2 non-overlapping combos
    assert len(schedules) == 2

    # Each schedule has 2 bundles (one per course)
    for sched in schedules:
        assert len(sched) == 2
        # ensure no conflicts
        blocks = [blk for b in sched for blk in b.all_blocks]
        for i, a in enumerate(blocks):
            for b in blocks[i+1:]:
                assert not scheduler._conflicts(a, b)
