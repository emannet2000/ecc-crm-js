const {parentPort,workerData}=require('node:worker_threads');
(async()=>{try{
 const data=Buffer.from(workerData);let end=-1;for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(data.readUInt32LE(i)===0x06054b50){end=i;break}
 if(end<0||data.readUInt16LE(end+4)||data.readUInt16LE(end+6))throw Error('INVALID_XLSX_ARCHIVE');
 const count=data.readUInt16LE(end+10);if(count>256)throw Error('XLSX_TOO_MANY_ENTRIES');let offset=data.readUInt32LE(end+16),expanded=0;
 for(let i=0;i<count;i++){
  if(offset+46>data.length||data.readUInt32LE(offset)!==0x02014b50)throw Error('INVALID_XLSX_ARCHIVE');
  const size=data.readUInt32LE(offset+24),nameLength=data.readUInt16LE(offset+28),extra=data.readUInt16LE(offset+30),comment=data.readUInt16LE(offset+32);expanded+=size;
  if(size>8*1024*1024||expanded>16*1024*1024)throw Error('XLSX_EXPANDED_SIZE_LIMIT');
  const name=data.subarray(offset+46,offset+46+nameLength).toString();if(/vbaProject|externalLinks/i.test(name))throw Error('XLSX_MACROS_AND_EXTERNAL_LINKS_NOT_SUPPORTED');offset+=46+nameLength+extra+comment;
 }
 const Workbook=require('exceljs/lib/doc/workbook'),ValueType=require('exceljs/lib/doc/enums').ValueType,workbook=new Workbook();await workbook.xlsx.load(data,{ignoreNodes:['drawing','picture','conditionalFormatting','dataValidations','sheetProtection']});
 if(workbook.worksheets.length!==1)throw Error('XLSX_REQUIRES_ONE_WORKSHEET');const sheet=workbook.worksheets[0];
 if(sheet.rowCount>1001||sheet.columnCount>50)throw Error('XLSX_MAXIMUM_1000_DATA_ROWS_AND_50_COLUMNS');
 const rows=[];for(let i=1;i<=sheet.rowCount;i++){const row=[];for(let c=1;c<=sheet.columnCount;c++){const cell=sheet.getRow(i).getCell(c);if(cell.type===ValueType.Formula||cell.type===ValueType.Error)throw Error('XLSX_FORMULAS_AND_ERRORS_NOT_SUPPORTED');row.push(cell.text||'')}if(row.some(v=>v.trim()))rows.push(row)}
 const csv=rows.map(row=>row.map(v=>'"'+v.replaceAll('"','""')+'"').join(',')).join('\r\n');if(csv.length>2e6)throw Error('CSV_MAXIMUM_2MB');parentPort.postMessage({csv,headers:rows[0]||[],sheet:sheet.name});
 }catch(e){parentPort.postMessage({error:e.message})}})();
