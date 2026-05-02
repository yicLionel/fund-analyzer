'use client';

import ReactECharts from 'echarts-for-react';
import type { NavPoint } from '@/lib/types';

export default function NavChart({ data, title }: { data: NavPoint[]; title: string }) {
  const hasBenchmark = data.some((d) => typeof d.benchmark === 'number');
  const option = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    legend: {
      top: 0,
      textStyle: { color: '#9fb0c7' },
      data: hasBenchmark ? [title, '沪深300（归一化）'] : [title],
    },
    grid: { left: 50, right: 20, top: 40, bottom: 40 },
    xAxis: {
      type: 'category',
      data: data.map((d) => d.date),
      boundaryGap: false,
      axisLabel: { color: '#9fb0c7' },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: '#9fb0c7' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
    },
    series: [
      {
        name: title,
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: data.map((d) => d.nav),
        areaStyle: {},
      },
      ...(hasBenchmark
        ? [
            {
              name: '沪深300（归一化）',
              type: 'line',
              smooth: true,
              showSymbol: false,
              data: data.map((d) => d.benchmark ?? null),
              lineStyle: { color: '#f4b400', width: 2 },
              areaStyle: undefined,
            },
          ]
        : []),
    ],
  };

  return <ReactECharts option={option} style={{ height: 420, width: '100%' }} />;
}
