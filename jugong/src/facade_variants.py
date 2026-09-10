"""Photo-derived, shared catalogue and stable per-household weighted choices."""
CATALOG={
 'sash': [('none','없음',10),('partial','거실만',15),('full','전체',75)],
 'ac': [('none','없음',55),('bracket','빈 거치대',5),('unit','실외기 포함',40)],
 'sashVariant': [('two','넓은 2짝',30),('three','중앙 넓은 3분할',35),('four','4짝 미닫이',20),('transom','4짝 + 하부 고정띠',15)],
 'frameFinish': [('metal','은회 금속',55),('light','밝은 프레임',30),('dark','어두운 프레임',15)],
 'smallWindow': [('none','원래 창·열린 난간',35),('boxed','돌출 2짝',25),('roof','돌출 2짝 + 차양',30),('transom','하부 고정띠 + 차양',10)],
 'acPosition': [('bedroom','침실창 아래 벽걸이',50),('corner','발코니 모서리',20),('small_rail','작은방 난간 안',15),('small_wall','좁은 창 아래',10),('small_top','작은방 창 위',5)],
}
DEFAULTS=dict(sash='none',ac='none',sashVariant='three',frameFinish='metal',smallWindow='none',acPosition='bedroom')
FINISH_MATERIAL={'metal':0,'light':1,'dark':3}
SASH_PROFILES={'two':((1,1),.60,False),'three':((1,2.2,1),.65,False),'four':((1,1,1,1),.55,False),'transom':((1,1,1,1),.75,True)}

def weighted_choice(seed,key,field):
 h=2166136261
 for c in f'{seed}:{key}:{field}':h=((h^ord(c))*16777619)&0xffffffff
 h^=h>>16;h=(h*2246822507)&0xffffffff;h^=h>>13;h=(h*3266489909)&0xffffffff;h^=h>>16
 value=h/4294967296*sum(item[2] for item in CATALOG[field])
 for choice,_label,weight in CATALOG[field]:
  value-=weight
  if value<0:return choice
 return CATALOG[field][-1][0]

def normalize_seed(seed):
 if seed is not None and (isinstance(seed,bool) or not isinstance(seed,int) or not 0<=seed<=4294967295):raise ValueError('seed must be null or a uint32 integer')
 return seed

def resolve_state(seed,key,state):
 explicit=state.get('explicit',list(state))
 if not isinstance(explicit,list) or len(set(explicit))!=len(explicit) or any(f not in CATALOG for f in explicit):raise ValueError(f'invalid explicit fields: {key}')
 result={}
 for field,choices in CATALOG.items():
  value=state.get(field,DEFAULTS[field])
  if value not in [c[0] for c in choices]:raise ValueError(f'invalid {field}: {key}')
  result[field]=weighted_choice(seed,key,field) if seed is not None and field not in explicit else value
 result['explicit']=[f for f in CATALOG if f in explicit]
 return result

def selected_layers(state):
 result=[];v=state.get('sashVariant','three');p=state.get('acPosition','bedroom');finish=FINISH_MATERIAL[state.get('frameFinish','metal')]
 if state['sash']!='none':result.append((f'sash_partial__{v}',finish))
 if state['sash']=='full':result.append((f'sash_full__{v}',finish))
 small=state.get('smallWindow','none')
 if small!='none':result.append((f'small__{small}',finish))
 if state['ac']!='none':result.append((f'ac_bracket__{p}',3))
 if state['ac']=='unit':result.append((f'ac_unit__{p}',3))
 return result

LAYER_NAMES=('sash_partial','sash_full','ac_bracket','ac_unit')+tuple(f'{name}__{v}' for v in SASH_PROFILES for name in ('sash_partial','sash_full'))+tuple(f'small__{v}' for v in ('boxed','roof','transom'))+tuple(f'{name}__{v[0]}' for v in CATALOG['acPosition'] for name in ('ac_bracket','ac_unit'))
