import type { T } from '../i18n'
import { defaultDecoder, type DecoderConfig, type I2cConfig, type SpiConfig, type UartConfig } from '../lib/decoders'
import { estimateBaud } from '../lib/signal'
import type { Capture } from '../lib/types'

interface Props {
  cap: Capture
  decoders: DecoderConfig[]
  t: T
  onChange: (d: DecoderConfig[]) => void
}

function ChannelSelect({ cap, label, value, optional, onChange, t }: { cap: Capture; label: string; value: number | null; optional?: boolean; onChange: (v: number | null) => void; t: T }) {
  const bits = cap.signals.filter((s) => s.kind === 'bit')
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
        {optional && <option value="">{t('(none)')}</option>}
        {!optional && value === null && <option value="">{t('(choose)')}</option>}
        {bits.map((s) => (
          <option key={s.idx} value={s.idx}>
            {s.scope ? `${s.scope}.${s.name}` : s.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="number" value={value} min={min} max={max} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)} />
    </div>
  )
}

export default function DecoderPanel({ cap, decoders, t, onChange }: Props) {
  const set = (i: number, d: DecoderConfig) => onChange(decoders.map((x, j) => (j === i ? d : x)))
  const add = (kind: DecoderConfig['kind']) => onChange([...decoders, defaultDecoder(kind, cap)])

  const uart = (d: UartConfig, i: number) => {
    const upd = (p: Partial<UartConfig>) => set(i, { ...d, ...p })
    return (
      <>
        <ChannelSelect cap={cap} label={t('Line (TX or RX)')} value={d.rx} onChange={(v) => upd({ rx: v })} t={t} />
        <div className="grid2">
          <Num label={t('Baud rate')} value={d.baud} min={50} max={50_000_000} onChange={(n) => upd({ baud: n })} />
          <div className="field">
            <label>&nbsp;</label>
            <button
              onClick={() => {
                const est = d.rx === null ? null : estimateBaud(cap.signals[d.rx], cap.timescale)
                if (est) upd({ baud: est })
              }}
              disabled={d.rx === null}
            >
              {t('Auto baud')}
            </button>
          </div>
          <Num label={t('Data bits')} value={d.dataBits} min={5} max={9} onChange={(n) => upd({ dataBits: Math.round(n) })} />
          <div className="field">
            <label>{t('Parity')}</label>
            <select value={d.parity} onChange={(e) => upd({ parity: e.target.value as UartConfig['parity'] })}>
              <option value="none">{t('None')}</option>
              <option value="even">{t('Even')}</option>
              <option value="odd">{t('Odd')}</option>
            </select>
          </div>
          <div className="field">
            <label>{t('Stop bits')}</label>
            <select value={d.stopBits} onChange={(e) => upd({ stopBits: Number(e.target.value) as 1 | 2 })}>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </div>
          <div className="field">
            <label>{t('Bit order')}</label>
            <select value={d.msbFirst ? 'msb' : 'lsb'} onChange={(e) => upd({ msbFirst: e.target.value === 'msb' })}>
              <option value="lsb">{t('LSB first')}</option>
              <option value="msb">{t('MSB first')}</option>
            </select>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={d.invert} onChange={(e) => upd({ invert: e.target.checked })} /> {t('Inverted line (idle low)')}
        </label>
      </>
    )
  }

  const spi = (d: SpiConfig, i: number) => {
    const upd = (p: Partial<SpiConfig>) => set(i, { ...d, ...p })
    return (
      <>
        <div className="grid2">
          <ChannelSelect cap={cap} label={t('Clock')} value={d.clk} onChange={(v) => upd({ clk: v })} t={t} />
          <ChannelSelect cap={cap} label={t('Chip select')} value={d.cs} optional onChange={(v) => upd({ cs: v })} t={t} />
          <ChannelSelect cap={cap} label="MOSI" value={d.mosi} optional onChange={(v) => upd({ mosi: v })} t={t} />
          <ChannelSelect cap={cap} label="MISO" value={d.miso} optional onChange={(v) => upd({ miso: v })} t={t} />
          <div className="field">
            <label>{t('Mode')}</label>
            <select value={d.cpol * 2 + d.cpha} onChange={(e) => upd({ cpol: (Number(e.target.value) >> 1) as 0 | 1, cpha: (Number(e.target.value) & 1) as 0 | 1 })}>
              <option value={0}>0 (CPOL 0, CPHA 0)</option>
              <option value={1}>1 (CPOL 0, CPHA 1)</option>
              <option value={2}>2 (CPOL 1, CPHA 0)</option>
              <option value={3}>3 (CPOL 1, CPHA 1)</option>
            </select>
          </div>
          <Num label={t('Bits per word')} value={d.bits} min={1} max={32} onChange={(n) => upd({ bits: Math.round(n) })} />
          <div className="field">
            <label>{t('Bit order')}</label>
            <select value={d.msbFirst ? 'msb' : 'lsb'} onChange={(e) => upd({ msbFirst: e.target.value === 'msb' })}>
              <option value="msb">{t('MSB first')}</option>
              <option value="lsb">{t('LSB first')}</option>
            </select>
          </div>
          <div className="field">
            <label>{t('CS active')}</label>
            <select value={d.csActiveLow ? 'low' : 'high'} onChange={(e) => upd({ csActiveLow: e.target.value === 'low' })}>
              <option value="low">{t('Low')}</option>
              <option value="high">{t('High')}</option>
            </select>
          </div>
        </div>
      </>
    )
  }

  const i2c = (d: I2cConfig, i: number) => (
    <div className="grid2">
      <ChannelSelect cap={cap} label="SCL" value={d.scl} onChange={(v) => set(i, { ...d, scl: v })} t={t} />
      <ChannelSelect cap={cap} label="SDA" value={d.sda} onChange={(v) => set(i, { ...d, sda: v })} t={t} />
    </div>
  )

  return (
    <div className="section">
      <h3>{t('Protocol decoders')}</h3>
      {decoders.length === 0 && <p className="hint">{t('Add a decoder to annotate UART, SPI or I2C traffic.')}</p>}
      {decoders.map((d, i) => (
        <div className="card" key={d.id}>
          <div className="row">
            <b>{d.kind === 'uart' ? 'UART' : d.kind === 'spi' ? 'SPI' : 'I2C'}</b>
            <span className="spacer" />
            <button className="small danger" onClick={() => onChange(decoders.filter((_, j) => j !== i))}>
              {t('Remove')}
            </button>
          </div>
          {d.kind === 'uart' ? uart(d, i) : d.kind === 'spi' ? spi(d, i) : i2c(d, i)}
        </div>
      ))}
      <div className="row">
        <button onClick={() => add('uart')}>+ UART</button>
        <button onClick={() => add('spi')}>+ SPI</button>
        <button onClick={() => add('i2c')}>+ I2C</button>
      </div>
    </div>
  )
}
