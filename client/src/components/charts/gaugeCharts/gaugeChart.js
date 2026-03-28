import * as d3 from 'd3';

export function createGaugeChart(container, value, {
  width, height, minValue = 0, maxValue = 100,
  label = '', colorScheme = 'blues', colors, animate = true,
  formatValue: fmtFn, thresholds,
}) {
  const shortGauge = height < 100;
  const size = Math.min(width, height * 1.3);
  const radius = size * 0.42;
  const arcWidth = radius * 0.22;

  const startAngle = -Math.PI * 0.75;
  const endAngle = Math.PI * 0.75;
  const angleRange = endAngle - startAngle;

  const svg = d3.select(container)
    .selectAll('svg').data([null]).join('svg')
    .attr('width', width).attr('height', height);

  const cx = width / 2;
  const cy = height * 0.55;
  const g = svg.selectAll('g.gauge-root').data([null]).join('g')
    .attr('class', 'gauge-root')
    .attr('transform', `translate(${cx},${cy})`);

  const bgArc = d3.arc()
    .innerRadius(radius - arcWidth).outerRadius(radius)
    .startAngle(startAngle).endAngle(endAngle)
    .cornerRadius(arcWidth / 2);

  g.selectAll('path.gauge-bg').data([null]).join('path')
    .attr('class', 'gauge-bg').attr('d', bgArc()).attr('fill', 'rgba(148, 163, 184, 0.12)');

  const clampedValue = Math.max(minValue, Math.min(maxValue, value));
  const ratio = (clampedValue - minValue) / (maxValue - minValue || 1);
  const targetAngle = startAngle + ratio * angleRange;

  const valueArc = d3.arc()
    .innerRadius(radius - arcWidth).outerRadius(radius)
    .startAngle(startAngle).cornerRadius(arcWidth / 2);

  const fillColor = (colors && colors.length > 0 && !thresholds)
    ? colors[Math.min(Math.floor(ratio * colors.length), colors.length - 1)]
    : getGaugeColor(ratio, colorScheme, thresholds);

  const valuePath = g.selectAll('path.gauge-value').data([null]).join('path')
    .attr('class', 'gauge-value').attr('fill', fillColor);

  if (animate) {
    valuePath.transition().duration(1200).ease(d3.easeCubicOut)
      .attrTween('d', function() {
        const interp = d3.interpolate(startAngle, targetAngle);
        return t => valueArc.endAngle(interp(t))();
      });
  } else {
    valuePath.attr('d', valueArc.endAngle(targetAngle)());
  }

  const needleLen = radius * 0.75;
  const needleG = g.selectAll('g.needle').data([null]).join('g').attr('class', 'needle');

  needleG.selectAll('circle.needle-hub').data([null]).join('circle')
    .attr('class', 'needle-hub').attr('r', arcWidth * 0.35).attr('fill', '#cbd5e1');

  const needlePath = needleG.selectAll('line.needle-line').data([null]).join('line')
    .attr('class', 'needle-line')
    .attr('x1', 0).attr('y1', 0)
    .attr('stroke', '#cbd5e1').attr('stroke-width', 2).attr('stroke-linecap', 'round');

  if (animate) {
    needlePath.transition().duration(1200).ease(d3.easeCubicOut)
      .attrTween('x2', () => {
        const interp = d3.interpolate(startAngle, targetAngle);
        return t => Math.sin(interp(t)) * needleLen;
      })
      .attrTween('y2', () => {
        const interp = d3.interpolate(startAngle, targetAngle);
        return t => -Math.cos(interp(t)) * needleLen;
      });
  } else {
    needlePath
      .attr('x2', Math.sin(targetAngle) * needleLen)
      .attr('y2', -Math.cos(targetAngle) * needleLen);
  }

  const smartFmt = (v) => {
    if (v == null) return '—';
    if (Math.abs(v) >= 1e9) return d3.format(',.1f')(v / 1e9) + 'B';
    if (Math.abs(v) >= 1e6) return d3.format(',.1f')(v / 1e6) + 'M';
    if (Math.abs(v) >= 1e4) return d3.format(',.0f')(v);
    if (Number.isInteger(v)) return d3.format(',')(v);
    return d3.format(',.2f')(v);
  };
  const fmt = fmtFn || smartFmt;
  const valueFontSize = shortGauge ? Math.max(10, radius * 0.2) : Math.max(14, radius * 0.3);

  g.selectAll('text.gauge-label').data([]).join('text');

  g.selectAll('text.gauge-value-text').data([null]).join('text')
    .attr('class', 'gauge-value-text')
    .attr('y', radius * 0.55)
    .attr('text-anchor', 'middle').attr('fill', '#e2e8f0')
    .attr('font-size', valueFontSize).attr('font-weight', 600)
    .text(fmt(value));

  const tickFmt = d3.format(',.0f');
  g.selectAll('text.gauge-min').data(shortGauge ? [] : [null]).join('text')
    .attr('class', 'gauge-min')
    .attr('x', Math.sin(startAngle) * (radius + 12))
    .attr('y', -Math.cos(startAngle) * (radius + 12))
    .attr('text-anchor', 'middle').attr('fill', '#94a3b8').attr('font-size', 10)
    .text(tickFmt(minValue));

  g.selectAll('text.gauge-max').data(shortGauge ? [] : [null]).join('text')
    .attr('class', 'gauge-max')
    .attr('x', Math.sin(endAngle) * (radius + 12))
    .attr('y', -Math.cos(endAngle) * (radius + 12))
    .attr('text-anchor', 'middle').attr('fill', '#94a3b8').attr('font-size', 10)
    .text(tickFmt(maxValue));
}

function getGaugeColor(ratio, scheme, thresholds) {
  if (thresholds) {
    if (ratio <= (thresholds.low ?? 0.33)) return thresholds.lowColor || '#e74c3c';
    if (ratio <= (thresholds.mid ?? 0.66)) return thresholds.midColor || '#f39c12';
    return thresholds.highColor || '#2ecc71';
  }
  const schemes = {
    blues: ['#1e88e5', '#42a5f5', '#90caf9'],
    greens: ['#43a047', '#66bb6a', '#a5d6a7'],
    reds: ['#e53935', '#ef5350', '#ef9a9a'],
    oranges: ['#fb8c00', '#ffa726', '#ffcc80'],
    purples: ['#8e24aa', '#ab47bc', '#ce93d8'],
    viridis: ['#440154', '#21918c', '#fde725'],
  };
  const pal = schemes[scheme] || schemes.blues;
  if (ratio < 0.5) return d3.interpolateRgb(pal[0], pal[1])(ratio * 2);
  return d3.interpolateRgb(pal[1], pal[2])((ratio - 0.5) * 2);
}
