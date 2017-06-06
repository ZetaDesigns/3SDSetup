    var finalZip = new JSZip();
    var rateLimit = null;
    var rateLimited = false;
    var totalSteps = 0;
    var finishedSteps = 0;
    var setupList;

    $.get("data/setup.json", function(list) {
        setupList = list;
    });

    function downloadZip() {
        if(!totalSteps > 0 && finishedSteps >= totalSteps) {
            return;
        }

        finalZip.generateAsync({ type:"blob" })
        .then(function (blob) {
            saveAs(blob, "generic_name.zip");
        });
    }

    function startSetup(data){
        updateRateLimit();
        $('#download_btn').click(function() {
            downloadZip();
        });

            setupList["otherapp"].url = updatePayload();
            setupList["Soundhax"].url = soundhaxURL();

            $("#inner1").hide();
            $("#inner2").show();
            readList(data);
    }

    function readList(list){
        for(var i=0;i<list.length;i++){
            var itemName = list[i];
            if(itemName && setupList.hasOwnProperty(itemName)) {
                evaluateItem(itemName);
            }
        }
    }

    function evaluateItem(itemName) {
        var item = setupList[itemName];

        switch(item.type) {
            case "github":
                runGithub(item,itemName);
                break;
            case "direct":
                runDirect(item,itemName);
                break;
            case "list":
                readList(item.steps);
                break;
        }
    }

    function evaluateStep(step, data, name) {
        switch(step.type){
            case "extractFile":
                if(step.fileExtract) {
                    getFileBuffer_zip(data, step.fileExtract, step.path);
                } else if(step.files) {
                    step.files.forEach(function(fileStep) {
                        getFileBuffer_zip(data, fileStep.file, fileStep.path);
                    });
                } else {
                    extractZip(data, step.path, step.removePath);
                }
                break;

            case "addFile":
                addFile(data, step.path, step.file);
                break;

            case "deleteFile":
                if(step.file) {
                    deletefile_zip(data,step.file);
                } else if(step.files) {
                    step.files.forEach(function(fileStep) {
                        deletefile_zip(data, fileStep.file);
                    });
                }

                break;

            case "folder":
                folder(step.name);
                break;
            // add more
        }
        progress(name, name + " : Added (∩ ͡° ͜ʖ ͡°)⊃━☆ﾟ");

        finishedSteps++; // kinda
        if(totalSteps === finishedSteps) {
            $('#download_btn').text("Download");
        }

        //element.childNodes[element.childNodes.length -1].innerText = "(Added!)";
    }

    // Prepares files and runs each step passing the downloaded files.
    function runGithub(item,name) {
        getGithubRelease(item, function(err, info) {
            item.steps.forEach(function(step) {
                totalSteps++;

                var asset = getGithubAsset(info.assets, step.file);
                if(asset === null) {
                    console.log("no asset found for " + step.file);
                    return;
                }

                getFileBuffer_url(corsURL(asset.browser_download_url), name,function(data) {
                    evaluateStep(step, data, name);
                });
            });
        });
    }

    function runDirect(item,name) {
        totalSteps++;

        getFileBuffer_url(corsURL(item.url), name, function(data) {
            item.steps.forEach(function(step) {
                evaluateStep(step, data, name);
            });
        });
    }

    function getGithubRelease(options, callback) {
        callback = callback || function(){};

        if(rateLimited) {
            callback(new Error("Rate limited lol :p"));
            return;
        }

        var defaults = {
            repo: "",
            version: "latest"
        };

        options = $.extend(defaults, options);
        if(!options.repo) {
            callback(new Error("Repo name is required"), null);
            return;
        }

        var url = "https://api.github.com/repos/" + options.repo + "/releases";
        if(options.version === "latest") {
            url += "/latest";
        } else if(options.version !== "") {
            url += "/tags/" + options.version;
        }

        $.getJSON(url, function(data) {
            if(options.version === "") {
                data = data[0];
            }

            callback(null, data);
        }).fail(function(jqXHR) {
            //rateLimit(jqXHR);
        });
    }

    function getFileBuffer_url(url, name, callback) {
        console.log("Downloading " + url);
        callback = callback || function(){};

        var xhr = new XMLHttpRequest();
        xhr.open("GET", url);
        xhr.responseType = "arraybuffer";

        xhr.onload = function () {
            if(this.status !== 200) {
                console.log(this.status);
                // TODO: handle error with callback
                return;
            }

            var fileBlob = new Blob([xhr.response]);
            var fileReader = new FileReader();

            fileReader.onload = function() {
                console.log("Downloaded " + url);
                progress(name,name + ": Download Finished");
                if(url.endsWith('.zip')){
                    JSZip.loadAsync(this.result).then(function (data) {
                        callback(data);
                    });
                } else {
                    callback(this.result);
                }
            };

            fileReader.readAsArrayBuffer(fileBlob);
        };

        xhr.onprogress = function (e) {
        if (e.lengthComputable) {
            var percent = Math.floor((e.loaded / e.total) * 100);
            progress(name,name + ": " + percent + " %");
            //element.childNodes[element.childNodes.length -1].innerText = "(" + percent + ")";
        }
        };

        xhr.onerror = function(){
            console.log(this.status);
            getFileBuffer_url(url,name);
        };

        xhr.send();
    }

    function getFileBuffer_zip(data, originalName, path, newName){
        //should work with relative and not absolute names (not implemented)
        newName = newName || originalName;

        try {
            data.file(originalName).async("arraybuffer").then(function(content){
                addFile(content, path, newName);
            });
        } catch(e) {
            console.log("Could not get " + originalName + " from some zip file");
            console.log(data);
        }

    }

    function extractFolder(data, folder, path){
        var file_count2 = 0;

        Object.keys(data.files).forEach(function(filename){
            var file = data.files[filename];
            if (file.dir || !filename.startsWith(folder)) {
                file_count2++;
                return;
            }

            file.async("arraybuffer").then(function(content) {
                file_count2++;
                addFile(content, path, filename);

                if(file_count2 == Object.keys(data.files).length){
                    progress_finish(bufferName, bufferName + ": Added to Zip");
                }
            });
        });
    }

    function extractZip(data, path, removePath){
        //progress(bufferName, bufferName + ": Extracting");
        var fileCount = 0;

        Object.keys(data.files).forEach(function(key){
            var file = data.files[key];
            var filename = file.name;
            if(removePath != ""){
                filename = filename.replace(removePath + "/", "");
            };

            if (file.dir) {
                fileCount++;
                return;
            }

            file.async("arraybuffer").then(function(content) {
                fileCount++;
                addFile(content, path, filename);
            });
        });
    }

    function addFile(buffer, path, filename) {
        if(path === ""){
            finalZip.file(filename, buffer);
        } else {
            finalZip.folder(path).file(filename, buffer);
        }
    }

    function deletefile_zip(data, filename){
        data.remove(filename);
    }

    function folder(name){
        finalZip.file(name + "/dummy.txt", "i love ice cream");
        finalZip.remove(name + "/dummy.txt");
    }

    function loadRateLimit() {
        $.getJSON("https://api.github.com/rate_limit", function(data){
            rateLimit = data.resources.core;
            updateRateLimit(true);
            setTimeout(loadRateLimit, 20000);
        });
    }

    function updateRateLimit(noTimeout) {
        if(typeof noTimeout === "undefined") {
            noTimeout = false;
        }

        if(!rateLimit) {
            loadRateLimit();
            return;
        }

        var reset = (new Date(rateLimit.reset * 1000));
        var now = (new Date()) * 1;
        var delta = Math.floor((reset - now) / 1000);
        /*$('#rl').text("Rate limit: " + delta + " seconds until reset. ")
            .append(rateLimit.remaining + "/" + rateLimit.limit + " remaining");*/

        rateLimited = rateLimit.remaining === 0;
        if(delta <= 0) {
            loadRateLimit();
        }

        if(!noTimeout) {
            setTimeout(updateRateLimit, 500);
        }
    }

    function corsURL(url) {
        return "https://cors-anywhere.herokuapp.com/" + url;
    }

    function getGithubAsset(assets, filename) {
        if(assets === null) {
            return null;
        }

        var keys = Object.keys(assets);
        for(var key in keys) {
            if(!keys.hasOwnProperty(key)) continue;

            var asset = assets[key];
            if(asset.name.indexOf(filename) > -1 || asset.name === filename){
                return asset;
            }
        }

        return null;
    }

//3SDSetup stuff
function progress(step,message){
    if(document.getElementById(step) !== null){
        document.getElementById(step).innerHTML = message;
    }else{
        $("#progress").append("<div id='" + step + "'>" + message + "</div>");
    }
}

function soundhaxURL(){
    var req_data = consoleinfo();

    var console = req_data["0"].value;
    var region = req_data["5"].value;

    switch (console)
    {
        case "OLD":
            console = "o3ds";
            break;
            case "NEW":
            console = "n3ds";
            break;
    }

    switch (region)
    {
        case "E":
            region = "eur";
            break;
        case "U":
            region = "usa";
            break;
        case "J":
            region = "jpn";
            break;
        case "K":
            region = "kor";
            break;
    }

    return "https://raw.githubusercontent.com/nedwill/soundhax/master/soundhax-" + region + "-" + console + ".m4a";
}

function consoleinfo(){
    return $("#data_ver").serializeArray();
}

function startup_CFW(){
    var step_list = set_step_list();
    console.log(step_list);
    if(step_list){

        download_msg = toastr["warning"]("Once all downloads finish, click 'Download Zip' and extract everything inside the given zip into your SD Card");
        $('html').addClass("bg_change");

        startSetup(step_list);
    }
}
