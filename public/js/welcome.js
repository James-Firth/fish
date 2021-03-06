'use strict';
/*global document:true, location:true, io:true, console:true, $:true, 
langs:true */

var socket = io.connect();

var lang = $.url().param('lang');
var messages;
if (lang && lang !== '' && lang.toLowerCase() in langs) {
   messages = langs[lang.toLowerCase()];
} else {
   messages = langs.en;
   lang = 'en';
}

socket.on('connect', function () {
   console.log('Connected to Fish server.');
});

socket.on('valid-group', function() {
   // Go to main window
   location.href = 'main.html?gid=' + $('#gid').val() +
      '&pid=' + $('#pid').val() +
      '&lang=' + lang;
});

socket.on('invalid-group', function() {
   $('#login').prop('disabled', false);
   $('.status-message')
      .toggleClass('red')
      .text(messages.login_invalidGroup);
});

var validateGroup = function () {
   var gid = $('#gid').val();
   $('#login').prop('disabled', true);
   $('.status-message').text(messages.login_validating);
   socket.emit('validate group', gid);
};


function loadLabels() {
   $('#welcome').text(messages.login_welcome);
   $('#instructions').text(messages.login_instructions);
   $('#gid_label').text(messages.login_simulationName + ' ');
   $('#pid_label').text(messages.login_participantId + ' ');
   $('#login').text(messages.login_getStarted);
}


var Main = function() {
   document.title = messages.login_title;
   loadLabels();
   $('#login').click(validateGroup);
};

$(document).ready(Main);

