window.generateTableHTML = function(logs, nepD, dateEng, monthName, isPdf = false, overrideType = null, allowEdit = false) {
    const exportTypeEl = document.getElementById('export-type');
    const type = overrideType || (exportTypeEl ? exportTypeEl.value : 'generation');
    
    const v = (val, dec=2) => (val === null || val === undefined || val === '') ? '' : Number(val).toFixed(dec);
    const s = (val) => (val === null || val === undefined) ? '' : String(val);

    let shiftA = '', shiftB = '', shiftC = '';
    logs.forEach(l => {
        const t = l.log_time ? l.log_time.substring(0, 5) : '';
        if (t === '05:00' && l.remarks) shiftA = l.remarks;
        if (t === '13:00' && l.remarks) shiftB = l.remarks;
        if (t === '21:00' && l.remarks) shiftC = l.remarks;
    });

    const monthSelect = document.getElementById('export-month');
    const monthNum = monthSelect ? parseInt(monthSelect.value || 1) : 1;
    const yearEl = document.getElementById('export-year');
    const yearNum = yearEl && yearEl.value ? parseInt(yearEl.value) : new Date().getFullYear() + 57;
    const fyString = monthNum >= 4 ? `${yearNum}/${yearNum + 1}` : `${yearNum - 1}/${yearNum}`;

    let html = `<div style="background:#fff; padding:15px; font-family: 'Times New Roman', Times, serif; color:#000; font-size: 12px;">`;

    if (type === 'schedule3') {
        html += `
        <div style="margin-bottom: 10px; line-height: 1.4;">
            <div style="text-align: left; margin-bottom: 5px; font-size: 14px;"><b>SCHEDULE 3: DAILY LOG SHEET</b></div>
            <table style="width: 100%; border: none; font-size: 12px; font-family: 'Times New Roman', Times, serif;">
                <tr>
                    <td style="text-align: left; width: 35%; border: none; padding: 0;"><b>Makari Gad Hydropower Limited</b></td>
                    <td style="text-align: left; width: 30%; border: none; padding: 0;"></td>
                    <td style="text-align: left; width: 35%; border: none; padding: 0;"><b>Site Office: Apihimal-5, Makarigad, Darchula</b></td>
                </tr>
                <tr>
                    <td style="text-align: left; border: none; padding: 0;"><b>Makari Gad Hydroelectric Project</b></td>
                    <td style="text-align: left; border: none; padding: 0;"></td>
                    <td style="text-align: left; border: none; padding: 0;"><b>Email: makarigad@gmail.com</b></td>
                </tr>
                <tr>
                    <td style="text-align: left; border: none; padding: 0;">Head Office: Maharajgunj-3, Kathmandu</td>
                    <td style="text-align: left; border: none; padding: 0;"></td>
                    <td style="text-align: left; border: none; padding: 0;">Tel: 9851275191</td>
                </tr>
                <tr>
                    <td style="text-align: left; border: none; padding: 0;">Tel: 014720530</td>
                    <td style="text-align: left; border: none; padding: 0;">Nepali Date: ${nepD || ''}</td>
                    <td style="text-align: left; border: none; padding: 0;"></td>
                </tr>
                <tr>
                    <td style="text-align: left; border: none; padding: 0;"><b>FISCAL YEAR:</b> ${fyString} &nbsp;&nbsp;&nbsp; <b>Month:</b> ${monthName || ''}</td>
                    <td style="text-align: left; border: none; padding: 0;">English Date: ${dateEng || ''}</td>
                    <td style="text-align: left; border: none; padding: 0;"></td>
                </tr>
            </table>
        </div>
        `;
    } else {
        let titleText = type === 'generation' ? 'Generation Summary' : 
                        type === 'tempoil' ? 'Operation Log Sheet (Temp & Oil)' : '33 kV Log Sheet';
        html += `
        <div class="pdf-title" style="text-align:center; font-weight:bold; font-size: 16px; margin-bottom: 5px;">Makari Gad Hydropower Limited<br>${titleText}</div>
        <div style="display:flex; justify-content:space-between; margin-bottom:10px; font-weight:bold; font-size: 14px;">
            <div class="english-date-header">English Date: ${dateEng || ''}</div>
            <div class="nepali-date-header">Nepali Date: ${nepD || ''}</div>
        </div>
        `;
    }

    html += `<table class="excel-table" style="width: 100%; border-collapse: collapse; text-align: center; border: 1px solid #000; font-size: 11px;"><thead>`;

    if (type === 'generation') {
        html += `
            <tr>
                <th rowspan="2" style="border:1px solid #000;">Time</th>
                <th colspan="2" style="border:1px solid #000;">Status</th>
                <th colspan="2" style="border:1px solid #000;">Hour Counter</th>
                <th colspan="2" style="border:1px solid #000;">Load (MW)</th>
                <th colspan="2" style="border:1px solid #000;">Power factor</th>
                <th colspan="2" style="border:1px solid #000;">PMU (GWh)</th>
                <th colspan="2" style="border:1px solid #000;">Feeder (MWh)</th>
                <th rowspan="2" style="border:1px solid #000;">SST</th>
                <th rowspan="2" style="border:1px solid #000;">Outgoing</th>
                <th rowspan="2" style="border:1px solid #000;">Import</th>
                <th rowspan="2" style="border:1px solid #000;">Water Lvl</th>
                <th rowspan="2" style="border:1px solid #000;">Operator</th>
                ${allowEdit ? `<th rowspan="2" style="border:1px solid #cbd5e1; background:#e0e7ff; color:#4f46e5; font-family:'Inter', sans-serif;">Action</th>` : ''}
            </tr>
            <tr>
                <th style="border:1px solid #000;">U1</th><th style="border:1px solid #000;">U2</th>
                <th style="border:1px solid #000;">U1</th><th style="border:1px solid #000;">U2</th>
                <th style="border:1px solid #000;">U1</th><th style="border:1px solid #000;">U2</th>
                <th style="border:1px solid #000;">U1</th><th style="border:1px solid #000;">U2</th>
                <th style="border:1px solid #000;">U1</th><th style="border:1px solid #000;">U2</th>
                <th style="border:1px solid #000;">U1</th><th style="border:1px solid #000;">U2</th>
            </tr>
        `;
    } else if (type === 'tempoil') {
        html += `
            <tr>
                <th rowspan="3" style="border:1px solid #000;">Time</th>
                <th colspan="10" style="border:1px solid #000;">Generator Details</th>
                <th colspan="8" style="border:1px solid #000;">Governor & Hydrostatic</th>
                <th colspan="3" style="border:1px solid #000;">Temp (C)</th>
                <th rowspan="3" style="border:1px solid #000;">Pressure</th>
                ${allowEdit ? `<th rowspan="3" style="border:1px solid #cbd5e1; background:#e0e7ff; color:#4f46e5; font-family:'Inter', sans-serif;">Action</th>` : ''}
            </tr>
            <tr>
                <th colspan="5" style="border:1px solid #000;">Unit 1</th><th colspan="5" style="border:1px solid #000;">Unit 2</th>
                <th colspan="4" style="border:1px solid #000;">Unit 1</th><th colspan="4" style="border:1px solid #000;">Unit 2</th>
                <th rowspan="2" style="border:1px solid #000;">Out</th><th rowspan="2" style="border:1px solid #000;">In</th><th rowspan="2" style="border:1px solid #000;">Intake</th>
            </tr>
            <tr>
                <th style="border:1px solid #000;">U</th><th style="border:1px solid #000;">V</th><th style="border:1px solid #000;">W</th><th style="border:1px solid #000;">DE</th><th style="border:1px solid #000;">NDE</th>
                <th style="border:1px solid #000;">U</th><th style="border:1px solid #000;">V</th><th style="border:1px solid #000;">W</th><th style="border:1px solid #000;">DE</th><th style="border:1px solid #000;">NDE</th>
                <th style="border:1px solid #000;">Gov</th><th style="border:1px solid #000;">Hyd</th><th style="border:1px solid #000;">Flow</th><th style="border:1px solid #000;">Lvl</th>
                <th style="border:1px solid #000;">Gov</th><th style="border:1px solid #000;">Hyd</th><th style="border:1px solid #000;">Flow</th><th style="border:1px solid #000;">Lvl</th>
            </tr>
        `;
    } else if (type === 'transformer') {
        html += `
            <tr>
                <th rowspan="2" style="border:1px solid #000;">Time</th>
                <th colspan="2" style="border:1px solid #000;">Trans #1</th>
                <th colspan="2" style="border:1px solid #000;">Trans #2</th>
                <th colspan="2" style="border:1px solid #000;">Aux (100kVA)</th>
                <th colspan="3" style="border:1px solid #000;">DG (125KVA)</th>
                ${allowEdit ? `<th rowspan="2" style="border:1px solid #cbd5e1; background:#e0e7ff; color:#4f46e5; font-family:'Inter', sans-serif;">Action</th>` : ''}
            </tr>
            <tr>
                <th style="border:1px solid #000;">Temp</th><th style="border:1px solid #000;">Lvl</th>
                <th style="border:1px solid #000;">Temp</th><th style="border:1px solid #000;">Lvl</th>
                <th style="border:1px solid #000;">Temp</th><th style="border:1px solid #000;">Lvl</th>
                <th style="border:1px solid #000;">Batt</th><th style="border:1px solid #000;">Fuel</th><th style="border:1px solid #000;">Runtime</th>
            </tr>
        `;
    } else if (type === 'schedule3') {
        html += `
            <tr>
                <th rowspan="3" style="border:1px solid #000;"><b>Time</b></th>
                <th colspan="11" style="border:1px solid #000;"><b>Generating Unit 1</b></th>
                <th colspan="11" style="border:1px solid #000;"><b>Generating Unit 2</b></th>
                <th colspan="11" style="border:1px solid #000;"><b>33 kV outgoing line</b></th>
                <th rowspan="3" style="border:1px solid #000;"><b>Remarks</b></th>
                ${allowEdit ? `<th rowspan="3" style="border:1px solid #cbd5e1; background:#e0e7ff; color:#4f46e5; font-family:'Inter', sans-serif;"><b>Action</b></th>` : ''}
            </tr>
            <tr>
                <th colspan="3" style="border:1px solid #000;">Generation Voltage (kV)</th><th colspan="3" style="border:1px solid #000;">Generation Current (A)</th><th colspan="2" style="border:1px solid #000;">Generator Output</th><th rowspan="2" style="border:1px solid #000;">PF<br>Cosø</th><th rowspan="2" style="border:1px solid #000;">Freq<br>Hz</th><th rowspan="2" style="border:1px solid #000;">Energy<br>GWh</th>
                <th colspan="3" style="border:1px solid #000;">Generation Voltage (kV)</th><th colspan="3" style="border:1px solid #000;">Generation Current (A)</th><th colspan="2" style="border:1px solid #000;">Generator Output</th><th rowspan="2" style="border:1px solid #000;">PF<br>Cosø</th><th rowspan="2" style="border:1px solid #000;">Freq<br>Hz</th><th rowspan="2" style="border:1px solid #000;">Energy<br>GWh</th>
                <th colspan="3" style="border:1px solid #000;">Line Voltage (kV)</th><th colspan="3" style="border:1px solid #000;">33kV Current (A)</th><th rowspan="2" style="border:1px solid #000;">MW</th><th rowspan="2" style="border:1px solid #000;">KVAR</th><th rowspan="2" style="border:1px solid #000;">PF<br>Cosø</th><th rowspan="2" style="border:1px solid #000;">Freq<br>Hz</th><th rowspan="2" style="border:1px solid #000;">Energy<br>MWh</th>
            </tr>
            <tr>
                <th style="border:1px solid #000;">R-Y</th><th style="border:1px solid #000;">Y-B</th><th style="border:1px solid #000;">B-R</th><th style="border:1px solid #000;">I1</th><th style="border:1px solid #000;">I2</th><th style="border:1px solid #000;">I3</th><th style="border:1px solid #000;">MW</th><th style="border:1px solid #000;">KVAR</th>
                <th style="border:1px solid #000;">R-Y</th><th style="border:1px solid #000;">Y-B</th><th style="border:1px solid #000;">B-R</th><th style="border:1px solid #000;">I1</th><th style="border:1px solid #000;">I2</th><th style="border:1px solid #000;">I3</th><th style="border:1px solid #000;">MW</th><th style="border:1px solid #000;">KVAR</th>
                <th style="border:1px solid #000;">R-Y</th><th style="border:1px solid #000;">Y-B</th><th style="border:1px solid #000;">B-R</th><th style="border:1px solid #000;">I1</th><th style="border:1px solid #000;">I2</th><th style="border:1px solid #000;">I3</th>
            </tr>
        `;
    }

    html += `</thead><tbody>`;

    for(let i=0; i<24; i++) {
        if(type === 'transformer' && i % 2 !== 0) continue;

        let hrStr = i.toString().padStart(2, '0');
        let timePrefix = hrStr + ':00'; 
        let t = timePrefix + ':00';
        
        let l = logs.find(x => x.log_time === t || (x.log_time && x.log_time.startsWith(timePrefix))) || {};

        html += `<tr><td style="border:1px solid #000; font-weight:bold;">${timePrefix}</td>`;

        if (type === 'generation') {
            html += `
                <td style="border:1px solid #000;">${s(l.u1_status)}</td><td style="border:1px solid #000;">${s(l.u2_status)}</td>
                <td style="border:1px solid #000;">${v(l.u1_hour_counter, 1)}</td><td style="border:1px solid #000;">${v(l.u2_hour_counter, 1)}</td>
                <td style="border:1px solid #000;">${v(l.e_u1_mw, 3)}</td><td style="border:1px solid #000;">${v(l.e_u2_mw, 3)}</td>
                <td style="border:1px solid #000;">${v(l.e_u1_cos, 3)}</td><td style="border:1px solid #000;">${v(l.e_u2_cos, 3)}</td>
                <td style="border:1px solid #000;">${v(l.e_u1_gwh, 3)}</td><td style="border:1px solid #000;">${v(l.e_u2_gwh, 3)}</td>
                <td style="border:1px solid #000;">${v(l.u1_feeder, 3)}</td><td style="border:1px solid #000;">${v(l.u2_feeder, 3)}</td>
                <td style="border:1px solid #000;">${v(l.sst, 1)}</td><td style="border:1px solid #000;">${v(l.e_out_mwh, 3)}</td>
                <td style="border:1px solid #000;">${v(l.import_mwh, 3)}</td><td style="border:1px solid #000;">${v(l.water_level, 2)}</td>
                <td style="border:1px solid #000;"></td>
            `;
        } 
        else if (type === 'tempoil') {
            html += `
                <td style="border:1px solid #000;">${v(l.t_u1_u, 0)}</td><td style="border:1px solid #000;">${v(l.t_u1_v, 0)}</td><td style="border:1px solid #000;">${v(l.t_u1_w, 0)}</td><td style="border:1px solid #000;">${v(l.t_u1_de, 0)}</td><td style="border:1px solid #000;">${v(l.t_u1_nde, 0)}</td>
                <td style="border:1px solid #000;">${v(l.t_u2_u, 0)}</td><td style="border:1px solid #000;">${v(l.t_u2_v, 0)}</td><td style="border:1px solid #000;">${v(l.t_u2_w, 0)}</td><td style="border:1px solid #000;">${v(l.t_u2_de, 0)}</td><td style="border:1px solid #000;">${v(l.t_u2_nde, 0)}</td>
                <td style="border:1px solid #000;">${v(l.t_u1_gov_temp, 0)}</td><td style="border:1px solid #000;">${v(l.t_u1_hyd_temp, 0)}</td><td style="border:1px solid #000;">${v(l.t_u1_oil_flow, 0)}</td><td style="border:1px solid #000;">${s(l.t_u1_oil_level)}</td>
                <td style="border:1px solid #000;">${v(l.t_u2_gov_temp, 0)}</td><td style="border:1px solid #000;">${v(l.t_u2_hyd_temp, 0)}</td><td style="border:1px solid #000;">${v(l.t_u2_oil_flow, 0)}</td><td style="border:1px solid #000;">${s(l.t_u2_oil_level)}</td>
                <td style="border:1px solid #000;">${v(l.t_temp_out, 1)}</td><td style="border:1px solid #000;">${v(l.t_temp_in, 1)}</td><td style="border:1px solid #000;">${v(l.t_temp_intake, 1)}</td><td style="border:1px solid #000;">${v(l.t_pressure, 2)}</td>
            `;
        }
        else if (type === 'transformer') {
            html += `
                <td style="border:1px solid #000;">${v(l.tr_1_temp, 0)}</td><td style="border:1px solid #000;">${v(l.tr_1_lvl, 1)}</td>
                <td style="border:1px solid #000;">${v(l.tr_2_temp, 0)}</td><td style="border:1px solid #000;">${v(l.tr_2_lvl, 1)}</td>
                <td style="border:1px solid #000;">${v(l.tr_aux_temp, 0)}</td><td style="border:1px solid #000;">${v(l.tr_aux_lvl, 1)}</td>
                <td style="border:1px solid #000;">${v(l.dg_batt, 1)}</td><td style="border:1px solid #000;">${v(l.dg_fuel, 2)}</td><td style="border:1px solid #000;">${s(l.dg_runtime)}</td>
            `;
        }
        else if (type === 'schedule3') {
            html += `
                <td style="border:1px solid #000;">${v(l.e_u1_v_ry, 2)}</td><td style="border:1px solid #000;">${v(l.e_u1_v_yb, 2)}</td><td style="border:1px solid #000;">${v(l.e_u1_v_br, 2)}</td>
                <td style="border:1px solid #000;">${v(l.e_u1_a_i1, 0)}</td><td style="border:1px solid #000;">${v(l.e_u1_a_i2, 0)}</td><td style="border:1px solid #000;">${v(l.e_u1_a_i3, 0)}</td>
                <td style="border:1px solid #000;">${v(l.e_u1_mw, 3)}</td><td style="border:1px solid #000;">${v(l.e_u1_kvar, 0)}</td><td style="border:1px solid #000;">${v(l.e_u1_cos, 2)}</td><td style="border:1px solid #000;">${v(l.e_u1_hz, 2)}</td><td style="border:1px solid #000;">${v(l.e_u1_gwh, 3)}</td>
                
                <td style="border:1px solid #000;">${v(l.e_u2_v_ry, 2)}</td><td style="border:1px solid #000;">${v(l.e_u2_v_yb, 2)}</td><td style="border:1px solid #000;">${v(l.e_u2_v_br, 2)}</td>
                <td style="border:1px solid #000;">${v(l.e_u2_a_i1, 0)}</td><td style="border:1px solid #000;">${v(l.e_u2_a_i2, 0)}</td><td style="border:1px solid #000;">${v(l.e_u2_a_i3, 0)}</td>
                <td style="border:1px solid #000;">${v(l.e_u2_mw, 3)}</td><td style="border:1px solid #000;">${v(l.e_u2_kvar, 0)}</td><td style="border:1px solid #000;">${v(l.e_u2_cos, 2)}</td><td style="border:1px solid #000;">${v(l.e_u2_hz, 2)}</td><td style="border:1px solid #000;">${v(l.e_u2_gwh, 3)}</td>
                
                <td style="border:1px solid #000;">${v(l.e_out_v_ry, 2)}</td><td style="border:1px solid #000;">${v(l.e_out_v_yb, 2)}</td><td style="border:1px solid #000;">${v(l.e_out_v_br, 2)}</td>
                <td style="border:1px solid #000;">${v(l.e_out_a_i1, 0)}</td><td style="border:1px solid #000;">${v(l.e_out_a_i2, 0)}</td><td style="border:1px solid #000;">${v(l.e_out_a_i3, 0)}</td>
                <td style="border:1px solid #000;">${v(l.e_out_mw, 3)}</td><td style="border:1px solid #000;">${v(l.e_out_kvar, 0)}</td><td style="border:1px solid #000;">${v(l.e_out_cos, 2)}</td><td style="border:1px solid #000;">${v(l.e_out_hz, 2)}</td><td style="border:1px solid #000;">${v(l.e_out_mwh, 3)}</td>
                
                <td style="border:1px solid #000;"></td> `;
        }
        
        // 🔥 INJECT THE EDIT BUTTON FOR OPERATORS/ADMINS 🔥
        if (allowEdit) {
            html += `<td style="border:1px solid #cbd5e1; background:#fff; text-align:center;">
                <button type="button" onclick="window.editLog('${timePrefix}', true)" style="cursor:pointer; padding:5px 12px; border-radius:4px; background:#4f46e5; color:#fff; border:none; font-weight:bold; font-size:11px; box-shadow:0 2px 4px rgba(0,0,0,0.1);">Edit</button>
            </td>`;
        }

        html += `</tr>`;
    }

    html += `</tbody></table>`;
    
   if (type === 'schedule3') {
        html += `<div style="margin-top: 30px; page-break-inside: avoid;">
            <table style="width: 100%; border-collapse: collapse; font-size: 11px; font-family: 'Times New Roman', Times, serif;">
                <tr>
                    <td style="border: none; text-align: left; width: 22%;"><strong>Shift A</strong></td>
                    <td style="border: none; width: 10%;"></td>
                    <td style="border: none; text-align: left; width: 22%;"><strong>Shift B</strong></td>
                    <td style="border: none; width: 10%;"></td>
                    <td style="border: none; text-align: left; width: 22%;"><strong>Shift C</strong></td>
                </tr>
                <tr>
                    <td style="border: none; text-align: left;">Name: ${shiftA}</td>
                    <td style="border: none;"></td>
                    <td style="border: none; text-align: left;">Name: ${shiftB}</td>
                    <td style="border: none;"></td>
                    <td style="border: none; text-align: left;">Name: ${shiftC}</td>
                </tr>
                <tr>
                    <td style="border: none; text-align: left; padding-bottom: 20px;">Signature: ....................</td>
                    <td style="border: none;"></td>
                    <td style="border: none; text-align: left; padding-bottom: 20px;">Signature: ....................</td>
                    <td style="border: none;"></td>
                    <td style="border: none; text-align: left; padding-bottom: 20px;">Signature: ....................</td>
                </tr>
                
                <tr><td colspan="5" style="border: none; height: 35px;"></td></tr>
                <tr><td colspan="5" style="border: none; height: 35px;"></td></tr>

                <tr>
                    <td colspan="5" style="border: none; text-align: left;">Signature: ........................................</td>
                </tr>
                <tr><td colspan="5" style="border: none; height: 10px;"></td></tr>
                <tr>
                    <td colspan="5" style="border: none; text-align: left;"><strong>Name: Upendra Chand</strong></td>
                </tr>
                <tr>
                    <td colspan="5" style="border: none; text-align: left;">Designation: Plant Manager</td>
                </tr>
                <tr>
                    <td colspan="5" style="border: none; text-align: left;">Official Seal</td>
                </tr>
            </table>
        </div>`;
    }

    html += `</div>`;
    return html;
};