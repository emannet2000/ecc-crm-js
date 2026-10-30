export function personDetails(body:Record<string,unknown>):Record<string,string|number|null> {
    const result:Record<string,string|number|null>={};
    for(const key of ['first_name','middle_name','last_name','nationality'])if(key in body){
        if(typeof body[key]!=='string'||body[key].length>100)throw Error('VALID_PERSON_DETAILS_REQUIRED');
        result[key]=body[key].trim();
    }
    for(const [key,max] of [['address',500],['gender',100]] as const)if(key in body){
        if(typeof body[key]!=='string'||body[key].length>max)throw Error('VALID_PERSON_DETAILS_REQUIRED');
        result[key]=body[key].trim();
    }
    if('age' in body){
        const age=body.age;
        if(age===null||age==='')result.age=null;
        else if((typeof age==='number'||typeof age==='string'&&/^\d+$/.test(age))&&Number.isInteger(Number(age))&&Number(age)>=0&&Number(age)<=120)result.age=Number(age);
        else throw Error('AGE_MUST_BE_A_WHOLE_NUMBER_BETWEEN_0_AND_120');
    }
    return result;
}
export function personName(body:Record<string,unknown>):string {
    return typeof body.first_name==='string'&&body.first_name.trim()&&typeof body.last_name==='string'&&body.last_name.trim()
        ? [body.first_name,body.middle_name,body.last_name].filter(v=>typeof v==='string'&&v.trim()).map(v=>(v as string).trim()).join(' ')
        : typeof body.full_name==='string'?body.full_name.trim():'';
}
