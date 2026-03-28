import * as d3 from 'd3';

export function createHistogramChart(container, data, {
  width, height, valueField, binCount = 20,
  colorScheme = 'blues', colors, animate = true,
  formatValue: fmtFn, showCurve = false,
}) {
  const isCompact = width < 250 || height < 180;
  const isTiny = width < 160 || height < 120;
  let margin = { top: 20, right: 20, bottom: 44, left: 56 };
  if (isTiny) {
    margin = { top: 4, right: 4, bottom: 18, left: 22 };
  } else if (isCompact) {
    margin = {
      top: Math.min(margin.top, 10),
      right: Math.min(margin.right, 10),
      bottom: Math.min(margin.bottom, 28),
      left: Math.min(margin.left, 36),
    };
  }
  const hideAxisTitles = isCompact || isTiny;
  const hideAxisTicks = isTiny;
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  if (innerW <= 0 || innerH <= 0 || !data.length) return;

  const values = data.map(d => +d[valueField]).filter(v => !isNaN(v));
  if (!values.length) return;

  const svg = d3.select(container)
    .selectAll('svg').data([null]).join('svg')
    .attr('width', width).attr('height', height);

  const g = svg.selectAll('g.hist-root').data([null]).join('g')
    .attr('class', 'hist-root')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const [minV, maxV] = d3.extent(values);
  const x = d3.scaleLinear().domain([minV, maxV]).nice(binCount).range([0, innerW]);

  const histogram = d3.bin().domain(x.domain()).thresholds(x.ticks(binCount)).value(d => d);
  const bins = histogram(values);
  const maxCount = d3.max(bins, d => d.length) || 1;

  const y = d3.scaleLinear().domain([0, maxCount]).nice().range([innerH, 0]);
  const barColor = (colors && colors.length > 0) ? colors[0] : getBarColor(colorScheme);

  const tooltip = d3.select(container).selectAll('.hist-tooltip').data([null]).join('div')
    .attr('class', 'hist-tooltip')
    .style('position', 'absolute').style('pointer-events', 'none').style('opacity', 0)
    .style('background', 'rgba(20,20,30,0.95)').style('color', '#e0e0e0')
    .style('padding', '6px 10px').style('border-radius', '6px')
    .style('font-size', '12px').style('box-shadow', '0 2px 8px rgba(0,0,0,0.4)')
    .style('z-index', '100').style('white-space', 'nowrap');

  const fmt = fmtFn || d3.format(',.1f');

  g.selectAll('rect.hist-bar')
    .data(bins)
    .join(
      enter => enter.append('rect').attr('class', 'hist-bar')
        .attr('x', d => x(d.x0) + 1)
        .attr('width', d => Math.max(0, x(d.x1) - x(d.x0) - 2))
        .attr('y', animate ? innerH : d => y(d.length))
        .attr('height', animate ? 0 : d => innerH - y(d.length))
        .attr('fill', barColor).attr('rx', 2)
        .call(s => animate && s.transition().duration(600).ease(d3.easeCubicOut)
          .attr('y', d => y(d.length))
          .attr('height', d => innerH - y(d.length))),
      update => update.transition().duration(400)
        .attr('x', d => x(d.x0) + 1)
        .attr('width', d => Math.max(0, x(d.x1) - x(d.x0) - 2))
        .attr('y', d => y(d.length))
        .attr('height', d => innerH - y(d.length)),
      exit => exit.remove()
    )
    .style('cursor', 'pointer')
    .on('mouseenter', function(event, d) {
      d3.select(this).attr('fill', d3.color(barColor).brighter(0.5));
      tooltip.html(`<strong>Range:</strong> ${fmt(d.x0)} – ${fmt(d.x1)}<br/><strong>Count:</strong> ${d3.format(',')(d.length)}`)
        .style('opacity', 1);
    })
    .on('mousemove', function(event) {
      const rect = container.getBoundingClientRect();
      tooltip.style('left', `${event.clientX - rect.left + 12}px`).style('top', `${event.clientY - rect.top - 10}px`);
    })
    .on('mouseleave', function() {
      d3.select(this).attr('fill', barColor);
      tooltip.style('opacity', 0);
    });

  if (showCurve && values.length > 10) {
    const kde = kernelDensityEstimator(kernelEpanechnikov(7), x.ticks(40));
    const density = kde(values);
    const densityScale = d3.scaleLinear()
      .domain([0, d3.max(density, d => d[1]) || 1])
      .range([innerH, 0]);

    const area = d3.area().curve(d3.curveBasis)
      .x(d => x(d[0])).y0(innerH).y1(d => densityScale(d[1]));

    g.selectAll('path.hist-density').data([null]).join('path')
      .attr('class', 'hist-density').datum(density)
      .attr('fill', d3.color(barColor).copy({ opacity: 0.15 }))
      .attr('stroke', barColor).attr('stroke-width', 2)
      .attr('d', area);
  }

  const xAxisG = g.selectAll('g.x-axis').data([null]).join('g')
    .attr('class', 'x-axis').attr('transform', `translate(0,${innerH})`);
  xAxisG.call(d3.axisBottom(x).ticks(Math.min(binCount, 10)).tickFormat(hideAxisTicks ? () => '' : d3.format(',.0f')))
    .selectAll('text').attr('fill', '#888');
  xAxisG.selectAll('.domain, .tick line').attr('stroke', '#444');

  xAxisG.selectAll('text.x-label').data(hideAxisTitles ? [] : [null]).join('text')
    .attr('class', 'x-label').attr('x', innerW / 2).attr('y', 36)
    .attr('text-anchor', 'middle').attr('fill', '#888').attr('font-size', 11)
    .text(valueField);

  const yAxisG = g.selectAll('g.y-axis').data([null]).join('g').attr('class', 'y-axis');
  const yAxis = d3.axisLeft(y).ticks(5);
  if (hideAxisTicks) yAxis.tickFormat(() => '');
  yAxisG.call(yAxis).selectAll('text').attr('fill', '#888');
  yAxisG.selectAll('.domain, .tick line').attr('stroke', '#444');

  yAxisG.selectAll('text.y-label').data(hideAxisTitles ? [] : [null]).join('text')
    .attr('class', 'y-label').attr('transform', 'rotate(-90)')
    .attr('x', -innerH / 2).attr('y', -40)
    .attr('text-anchor', 'middle').attr('fill', '#888').attr('font-size', 11)
    .text('Count');
}

function getBarColor(scheme) {
  const m = {
    blues: '#42a5f5', greens: '#66bb6a', reds: '#ef5350',
    oranges: '#ffa726', purples: '#ab47bc', viridis: '#35b779',
  };
  return m[scheme] || m.blues;
}

function kernelDensityEstimator(kernel, X) {
  return V => X.map(x => [x, d3.mean(V, v => kernel(x - v))]);
}

function kernelEpanechnikov(k) {
  return v => Math.abs(v /= k) <= 1 ? 0.75 * (1 - v * v) / k : 0;
}
