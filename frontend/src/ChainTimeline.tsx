import React from 'react';
import { Timeline, Tag, Empty } from 'antd';
import { CHAIN_TYPE_LABEL } from './labels';
import { fmtDateTime } from './time';

export default function ChainTimeline({ events }: { events: any[] }) {
  if (!events?.length) return <Empty description="暂无服务链记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <Timeline
      className="timeline-crisis"
      items={events.map(e => ({
        color: e.crisisRelated ? 'red' : 'green',
        children: (
          <div>
            <div>
              <Tag color={e.crisisRelated ? 'red' : 'green'} style={{ marginRight: 6 }}>
                {CHAIN_TYPE_LABEL[e.type] || e.type}
              </Tag>
              <span className={e.crisisRelated ? 'chain-crisis' : ''}>{e.detail}</span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {e.actorName} · {fmtDateTime(e.createdAt)} (UTC+8)
            </div>
          </div>
        ),
      }))}
    />
  );
}
