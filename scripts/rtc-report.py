"""Summarize the same-machine probe; retain raw samples compressed, not in chat."""
import json,gzip,statistics
from pathlib import Path
root=Path(__file__).resolve().parents[1]
inputs={'baseline':'/tmp/kanon-rtc-baseline.json','controls':'/tmp/kanon-rtc-controls.json','final':'/tmp/kanon-rtc-final.json'}
def med(v):
 v=[x for x in v if isinstance(x,(int,float))];return round(statistics.median(v),2) if v else None
summaries={}
for group,path in inputs.items():
 data=json.loads(Path(path).read_text());(root/'docs').mkdir(exist_ok=True)
 with gzip.open(root/'docs'/f'rtc-{group}-2026-10-26.json.gz','wt') as f:json.dump(data,f,separators=(',',':'))
 summaries[group]=[]
 for case in data['results']:
  samples=case['samples'];stable=[x for x in samples if x['elapsed']>=8]
  def values(key,side='guest',rows=stable):return [x[side]['stats'].get(key) for x in rows if x[side]['stats']]
  result={k:v for k,v in case.items() if k!='samples'}
  result.update(samples=len(samples),elapsed=round(samples[-1]['elapsed'],1),ageMs=med([x['guest']['ageMedian'] for x in stable]),jitterMs=med(values('jitterMs')),targetMs=med(values('targetJitterMs')),minimumMs=med(values('minimumJitterMs')),encodedFps=med(values('encoderFps','host')),decodedFps=med(values('decoderFps')),presentedFps=med(values('presentedFps')),encodeMs=med(values('encodeMs','host')),decodeMs=med(values('decodeMs')),dataRttMs=med(values('dataRttMs')),networkRttMs=med(values('rttMs')),lossPercent=med(values('lossPercent')),badFrames=samples[-1]['guest']['bad'],singlePeer=all(x['host']['pcs']==x['guest']['pcs']==1 for x in samples),singleVideoStream=all(x['host']['streams']==1 for x in samples),singleAnimationLoop=all(x['host']['rafs']==1 for x in samples))
  for label,a,b in [('early',60,180),('late',480,610)]:
   rows=[x for x in samples if a<=x['elapsed']<=b]
   result[label+'AgeMs']=med([x['guest']['ageMedian'] for x in rows]);result[label+'JitterMs']=med(values('jitterMs',rows=rows))
   result[label+'ClockOffsetMs']=med([1000*(x['guest']['stats']['seconds']-x['guest']['stats']['currentTime']) for x in rows if x['guest']['stats']])
  result['driftMs']=None if result['earlyClockOffsetMs'] is None or result['lateClockOffsetMs'] is None else round(result['lateClockOffsetMs']-result['earlyClockOffsetMs'],2)
  summaries[group].append(result)
(root/'docs'/'rtc-latency-results.json').write_text(json.dumps(summaries,indent=2)+'\n')
print(json.dumps(summaries,indent=2))
